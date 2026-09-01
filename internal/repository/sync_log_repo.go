package repository

import (
	"context"
	"log"
	"time"

	"owiki/internal/model"

	"gorm.io/gorm"
)

// 同步日志动作类型（SyncLog.Action 的合法值）。
// 命名风格「对象.动词」，前端按动作渲染图标/文案/颜色。
const (
	ActionFileCreate  = "file.create"  // 新增文档/附件
	ActionFileUpdate  = "file.update"  // 更新文档/附件
	ActionFileDelete  = "file.delete"  // 删除文档/附件
	ActionFileRename  = "file.rename"  // 重命名/移动
	ActionFileMerge   = "file.merge"   // 三方合并成功
	ActionFileConflict = "file.conflict" // 三方合并失败（冲突标记版落库）
	ActionFileEcho    = "file.echo"    // 内容未变的回声上传（iCloud 双通道典型）
	ActionDevConnect  = "device.connect" // 设备认证成功（hello）
	ActionDevUnbind   = "device.unbind"  // 设备解绑（bye）
)

// 同步日志操作来源
const (
	SourceWs      = "ws"
	SourceWeb     = "web"
	SourceOpenAPI = "openapi"
)

// 保留策略：30 天 + 单 vault 上限 5000 条（超出删除最旧的）
const (
	SyncLogRetention      = 30 * 24 * time.Hour
	SyncLogMaxPerVault    = 5000
	syncLogCleanupSweep   = 24 * time.Hour // 清理周期
	syncLogCleanupBurst   = 1000           // 单次删除上限（避免长事务卡 SQLite）
)

// SyncLogRepo 同步日志存储
type SyncLogRepo struct {
	db *gorm.DB
}

func NewSyncLogRepo(db *gorm.DB) (*SyncLogRepo, error) {
	if err := db.AutoMigrate(&model.SyncLog{}); err != nil {
		return nil, err
	}
	return &SyncLogRepo{db: db}, nil
}

// Record 写一条同步日志（异步安全：调用方可在请求路径里直接调）
func (r *SyncLogRepo) Record(ctx context.Context, vaultID int64, action, path, detail, source, deviceID, deviceName string, size int64) {
	if r == nil {
		return
	}
	entry := &model.SyncLog{
		VaultID: vaultID, Action: action, Path: path, Detail: detail,
		Source: source, DeviceID: deviceID, DeviceName: deviceName, Size: size,
	}
	if err := r.db.WithContext(ctx).Create(entry).Error; err != nil {
		// 日志写失败不能影响同步主流程，记到服务日志即可
		log.Printf("[synclog] record error: %v", err)
	}
}

// ListPage 游标分页查询（新→旧）：before 为上一页最旧一条的 id，0 表示第一页。
// actions 为空表示不过滤动作类型。返回本页数据 + 是否还有更早的记录。
func (r *SyncLogRepo) ListPage(ctx context.Context, vaultID int64, before int64, limit int, actions []string) ([]model.SyncLog, bool, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := r.db.WithContext(ctx).Where("vault_id = ?", vaultID)
	if before > 0 {
		q = q.Where("id < ?", before)
	}
	if len(actions) > 0 {
		q = q.Where("action IN ?", actions)
	}
	var logs []model.SyncLog
	err := q.Order("id DESC").Limit(limit + 1).Find(&logs).Error
	if err != nil {
		return nil, false, err
	}
	if len(logs) > limit {
		return logs[:limit], true, nil
	}
	return logs, false, nil
}

// Cleanup 删除超过保留期或超出单 vault 上限的日志。
// 返回删除条数；单轮最多删 syncLogCleanupBurst 条，超量由定时任务下次继续。
//（SQLite 不支持 DELETE ... LIMIT，用 IN (SELECT id ... LIMIT) 子查询分批）
func (r *SyncLogRepo) Cleanup(ctx context.Context) (int64, error) {
	cutoff := time.Now().Add(-SyncLogRetention)
	res := r.db.WithContext(ctx).
		Exec("DELETE FROM sync_logs WHERE id IN (SELECT id FROM sync_logs WHERE created_at < ? LIMIT ?)",
			cutoff, syncLogCleanupBurst)
	if res.Error != nil {
		return 0, res.Error
	}
	deleted := res.RowsAffected

	// 单 vault 超量：找出超限 vault，删除各自最旧的差额
	type row struct {
		VaultID int64
		Count   int64
	}
	var rows []row
	if err := r.db.WithContext(ctx).Model(&model.SyncLog{}).
		Select("vault_id, COUNT(*) as count").
		Group("vault_id").
		Having("COUNT(*) > ?", SyncLogMaxPerVault).
		Find(&rows).Error; err != nil {
		return deleted, err
	}
	for _, v := range rows {
		var cutoffID int64
		// 该 vault 第 (count - Max) 新的那条 id：比它旧的都该删
		if err := r.db.WithContext(ctx).Model(&model.SyncLog{}).
			Select("id").
			Where("vault_id = ?", v.VaultID).
			Order("id DESC").
			Offset(SyncLogMaxPerVault - 1).
			Limit(1).
			Scan(&cutoffID).Error; err != nil {
			continue
		}
		if cutoffID <= 0 {
			continue
		}
		res := r.db.WithContext(ctx).
			Exec("DELETE FROM sync_logs WHERE id IN (SELECT id FROM sync_logs WHERE vault_id = ? AND id < ? LIMIT ?)",
				v.VaultID, cutoffID, syncLogCleanupBurst)
		if res.Error == nil {
			deleted += res.RowsAffected
		}
	}
	return deleted, nil
}

// StartCleanupLoop 后台定时清理（每天一轮），返回停止函数。main 里启动。
func (r *SyncLogRepo) StartCleanupLoop(ctx context.Context) (stop func()) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(syncLogCleanupSweep)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if n, err := r.Cleanup(ctx); err != nil {
					log.Printf("[synclog] cleanup error: %v", err)
				} else if n > 0 {
					log.Printf("[synclog] cleanup removed %d entries", n)
				}
			}
		}
	}()
	return func() { <-done }
}

// DeleteByVault vault 删除时连带清理
func (r *SyncLogRepo) DeleteByVault(ctx context.Context, vaultID int64) error {
	return r.db.WithContext(ctx).Where("vault_id = ?", vaultID).
		Delete(&model.SyncLog{}).Error
}
