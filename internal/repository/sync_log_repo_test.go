package repository

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"owiki/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newTestSyncLogRepo(t *testing.T) *SyncLogRepo {
	t.Helper()
	// 独立内存库（不迁移 notes 表，SyncLogRepo 只需要 sync_logs）
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "log.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	r, err := NewSyncLogRepo(db)
	if err != nil {
		t.Fatalf("NewSyncLogRepo: %v", err)
	}
	return r
}

func TestSyncLogRecordAndPage(t *testing.T) {
	r := newTestSyncLogRepo(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		r.Record(ctx, 1, ActionFileCreate, "a.md", "", SourceWs, "dev-1", "Mac", 100)
	}
	r.Record(ctx, 1, ActionFileDelete, "b.md", "", SourceWeb, "", "Web 管理端", 0)
	r.Record(ctx, 2, ActionFileCreate, "other-vault.md", "", SourceWs, "dev-2", "Win", 10)

	// 第一页：vault 1 全部（新→旧）
	logs, hasMore, err := r.ListPage(ctx, 1, 0, 3, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 3 || !hasMore {
		t.Fatalf("first page want 3 + hasMore, got %d / %v", len(logs), hasMore)
	}
	if logs[0].Action != ActionFileDelete {
		t.Fatalf("newest should be delete, got %s", logs[0].Action)
	}
	// 游标翻页
	logs2, _, _ := r.ListPage(ctx, 1, logs[2].ID, 3, nil)
	if len(logs2) != 3 {
		t.Fatalf("second page want 3 got %d", len(logs2))
	}
	// 过滤：只要删除
	dels, _, _ := r.ListPage(ctx, 1, 0, 50, []string{ActionFileDelete})
	if len(dels) != 1 || dels[0].Path != "b.md" {
		t.Fatalf("filter deletes want b.md, got %+v", dels)
	}
	// vault 隔离
	other, _, _ := r.ListPage(ctx, 2, 0, 50, nil)
	if len(other) != 1 || other[0].VaultID != 2 {
		t.Fatalf("vault isolation failed: %+v", other)
	}
}

func TestSyncLogCleanupRetention(t *testing.T) {
	r := newTestSyncLogRepo(t)
	ctx := context.Background()

	// 旧日志（35 天前）应被清理；新日志保留
	old := &model.SyncLog{
		VaultID: 1, Action: ActionFileUpdate, Path: "old.md",
		Source: SourceWs, DeviceID: "d", DeviceName: "dev",
		CreatedAt: time.Now().Add(-35 * 24 * time.Hour),
	}
	if err := r.db.Create(old).Error; err != nil {
		t.Fatal(err)
	}
	r.Record(ctx, 1, ActionFileCreate, "new.md", "", SourceWs, "d", "dev", 1)

	n, err := r.Cleanup(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("cleanup want 1 deleted, got %d", n)
	}
	logs, _, _ := r.ListPage(ctx, 1, 0, 50, nil)
	if len(logs) != 1 || logs[0].Path != "new.md" {
		t.Fatalf("after cleanup want new.md only, got %+v", logs)
	}
}

func TestSyncLogCleanupCapPerVault(t *testing.T) {
	r := newTestSyncLogRepo(t)
	ctx := context.Background()

	// 单 vault 超量：建 SyncLogMaxPerVault + 200 条，清理后应只剩 5000
	total := SyncLogMaxPerVault + 200
	now := time.Now()
	entries := make([]model.SyncLog, 0, total)
	for i := 0; i < total; i++ {
		entries = append(entries, model.SyncLog{
			VaultID: 9, Action: ActionFileEcho, Path: "bulk.md",
			Source: SourceWs, DeviceID: "d", DeviceName: "dev",
			CreatedAt: now.Add(-time.Duration(i) * time.Second),
		})
	}
	if err := r.db.CreateInBatches(entries, 500).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := r.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var left int64
	r.db.Model(&model.SyncLog{}).Where("vault_id = ?", 9).Count(&left)
	if left != SyncLogMaxPerVault {
		t.Fatalf("after cleanup want %d left, got %d", SyncLogMaxPerVault, left)
	}
}
