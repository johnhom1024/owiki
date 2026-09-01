package repository

import (
	"context"
	"errors"

	"owiki/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

var ErrNotFound = errors.New("note not found")

// NoteRepo 笔记存储（SQLite）
type NoteRepo struct {
	db *gorm.DB
}

func NewNoteRepo(dsn string) (*NoteRepo, error) {
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	// SQLite 并发锁处理（同步写入频繁，避免与 Web 读取抢锁报 database is locked）：
	// ① 单连接串行化——所有 DB 操作排队，从根上消除锁竞争
	// ② busy_timeout——万一仍有锁，等待 5s 而非立即报错
	// ③ WAL——读写并发更友好 + 崩溃更安全
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	_ = db.Exec("PRAGMA busy_timeout = 5000").Error
	_ = db.Exec("PRAGMA synchronous = NORMAL").Error
	var mode string
	_ = db.Raw("PRAGMA journal_mode = WAL").Scan(&mode).Error

	if err := db.AutoMigrate(&model.Note{}); err != nil {
		return nil, err
	}
	// 旧版的 path 单列唯一索引会阻止多 vault 同路径，迁移掉
	//（新索引 idx_path_per_vault (vault_id, path) 已由 AutoMigrate 建好）
	if db.Migrator().HasIndex(&model.Note{}, "uni_notes_path") {
		if err := db.Migrator().DropIndex(&model.Note{}, "uni_notes_path"); err != nil {
			return nil, err
		}
	}
	return &NoteRepo{db: db}, nil
}

// DB 暴露底层连接（vault 迁移等场景复用同一 DB）
func (r *NoteRepo) DB() *gorm.DB { return r.db }

// ListHashes 某个 vault 的全量哈希清单（对账用）
func (r *NoteRepo) ListHashes(ctx context.Context, vaultID int64) (map[string]model.Note, error) {
	var notes []model.Note
	if err := r.db.WithContext(ctx).Where("vault_id = ?", vaultID).Find(&notes).Error; err != nil {
		return nil, err
	}
	m := make(map[string]model.Note, len(notes))
	for _, n := range notes {
		m[n.Path] = n
	}
	return m, nil
}

func (r *NoteRepo) GetByPath(ctx context.Context, vaultID int64, path string) (*model.Note, error) {
	var n model.Note
	err := r.db.WithContext(ctx).Where("vault_id = ? AND path = ?", vaultID, path).First(&n).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func (r *NoteRepo) Upsert(ctx context.Context, n *model.Note) error {
	// 按 (vault_id, path) upsert：存在则更新，不存在则创建
	var exist model.Note
	err := r.db.WithContext(ctx).Where("vault_id = ? AND path = ?", n.VaultID, n.Path).First(&exist).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.WithContext(ctx).Create(n).Error
	}
	if err != nil {
		return err
	}
	exist.Content = n.Content
	exist.ContentHash = n.ContentHash
	exist.Snapshot = n.Snapshot
	exist.SnapshotHash = n.SnapshotHash
	exist.Mtime = n.Mtime
	exist.Size = n.Size
	return r.db.WithContext(ctx).Save(&exist).Error
}

func (r *NoteRepo) Rename(ctx context.Context, vaultID int64, from, to string) error {
	if from == "" || to == "" || from == to {
		return errors.New("invalid rename")
	}
	src, err := r.GetByPath(ctx, vaultID, from)
	if err != nil {
		return err
	}
	if _, err := r.GetByPath(ctx, vaultID, to); err == nil {
		return errors.New("target path already exists")
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	src.Path = to
	return r.db.WithContext(ctx).Save(src).Error
}

func (r *NoteRepo) DeleteByPath(ctx context.Context, vaultID int64, path string) error {
	res := r.db.WithContext(ctx).Where("vault_id = ? AND path = ?", vaultID, path).Delete(&model.Note{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteByVault 删除某 vault 的全部笔记（vault 删除时连带清理）
func (r *NoteRepo) DeleteByVault(ctx context.Context, vaultID int64) error {
	return r.db.WithContext(ctx).Where("vault_id = ?", vaultID).Delete(&model.Note{}).Error
}

// MigrateVaultID 把 vault_id=0 的旧数据归入指定 vault（一次性迁移）
func (r *NoteRepo) MigrateVaultID(ctx context.Context, vaultID int64) error {
	return r.db.WithContext(ctx).Model(&model.Note{}).
		Where("vault_id = 0").Update("vault_id", vaultID).Error
}
