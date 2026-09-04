package repository

import (
	"context"
	"path/filepath"
	"testing"

	"owiki/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newSettingTestDB(t *testing.T) *SettingRepo {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "t.db")))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Setting{}); err != nil {
		t.Fatal(err)
	}
	repo, err := NewSettingRepo(db)
	if err != nil {
		t.Fatal(err)
	}
	return repo
}

func TestSettingUpsertAndLoadAll(t *testing.T) {
	r := newSettingTestDB(t)
	ctx := context.Background()

	// 不存在 → ok=false 非错误
	if _, ok, err := r.Get(ctx, "feature.share.enabled"); ok || err != nil {
		t.Fatalf("expect miss, got ok=%v err=%v", ok, err)
	}

	// set 两次同 key（upsert 不报错、值更新）
	if err := r.Set(ctx, "feature.share.enabled", "false"); err != nil {
		t.Fatal(err)
	}
	if err := r.Set(ctx, "feature.share.enabled", "true"); err != nil {
		t.Fatal(err)
	}

	v, ok, err := r.Get(ctx, "feature.share.enabled")
	if !ok || err != nil || v != "true" {
		t.Fatalf("get = %q ok=%v err=%v", v, ok, err)
	}

	all, err := r.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if all["feature.share.enabled"] != "true" {
		t.Fatalf("GetAll = %v", all)
	}
}
