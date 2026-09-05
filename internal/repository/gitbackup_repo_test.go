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

func newTestGitBackupRepo(t *testing.T) *GitBackupRepo {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "gb.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	r, err := NewGitBackupRepo(db)
	if err != nil {
		t.Fatalf("NewGitBackupRepo: %v", err)
	}
	return r
}

// GetOrCreate：首建默认值，二取同一条（幂等，不重置字段）。
func TestGitBackupGetOrCreate(t *testing.T) {
	r := newTestGitBackupRepo(t)
	ctx := context.Background()

	b1, err := r.GetOrCreate(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if b1.Enabled || b1.Branch != "main" || b1.DebounceSec != 15 || b1.Status != "idle" {
		t.Fatalf("defaults wrong: %+v", b1)
	}

	// 改字段后再次 GetOrCreate：不覆盖
	b1.Enabled = true
	b1.RemoteURL = "https://github.com/x/y.git"
	if err := r.Save(ctx, b1); err != nil {
		t.Fatal(err)
	}
	b2, err := r.GetOrCreate(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !b2.Enabled || b2.RemoteURL == "" {
		t.Fatalf("GetOrCreate must not reset: %+v", b2)
	}
}

// 不存在的 vault：GetByVault 返回 ErrGitBackupNotFound。
func TestGitBackupGetMissing(t *testing.T) {
	r := newTestGitBackupRepo(t)
	if _, err := r.GetByVault(context.Background(), 99); err != ErrGitBackupNotFound {
		t.Fatalf("want ErrGitBackupNotFound, got %v", err)
	}
}

// ListEnabled 只回 enabled 的。
func TestGitBackupListEnabled(t *testing.T) {
	r := newTestGitBackupRepo(t)
	ctx := context.Background()

	for _, vid := range []int64{1, 2, 3} {
		b, _ := r.GetOrCreate(ctx, vid)
		if vid != 2 {
			b.Enabled = true
			_ = r.Save(ctx, b)
		}
	}
	list, err := r.ListEnabled(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 enabled, got %d", len(list))
	}
}

// 状态回写：UpdateStatus / UpdateSuccess（pushed 与否）。
func TestGitBackupStatusUpdates(t *testing.T) {
	r := newTestGitBackupRepo(t)
	ctx := context.Background()
	_, _ = r.GetOrCreate(ctx, 7)

	now := time.Now()
	if err := r.UpdateStatus(ctx, 7, "error", "boom", now); err != nil {
		t.Fatal(err)
	}
	got, _ := r.GetByVault(ctx, 7)
	if got.Status != "error" || got.LastError != "boom" {
		t.Fatalf("status update: %+v", got)
	}

	if err := r.UpdateSuccess(ctx, 7, "abc123def456", true, now); err != nil {
		t.Fatal(err)
	}
	got, _ = r.GetByVault(ctx, 7)
	if got.Status != "idle" || got.LastError != "" || got.LastCommitSHA != "abc123def456" {
		t.Fatalf("success update: %+v", got)
	}
	if got.LastPushAt == nil {
		t.Fatal("LastPushAt should be set when pushed")
	}

	// pushed=false：不动 LastPushAt
	old := got.LastPushAt
	if err := r.UpdateSuccess(ctx, 7, "zzz", false, now); err != nil {
		t.Fatal(err)
	}
	got, _ = r.GetByVault(ctx, 7)
	if got.LastCommitSHA != "zzz" {
		t.Fatalf("sha not updated: %+v", got)
	}
	if !got.LastPushAt.Equal(*old) {
		t.Fatal("LastPushAt should not change when pushed=false")
	}
}

// vault 删除级联清理。
func TestGitBackupDeleteByVault(t *testing.T) {
	r := newTestGitBackupRepo(t)
	ctx := context.Background()
	if err := r.Save(ctx, &model.VaultGitBackup{VaultID: 10, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteByVault(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByVault(ctx, 10); err != ErrGitBackupNotFound {
		t.Fatalf("want not found after delete, got %v", err)
	}
}
