package repository

import (
	"context"
	"path/filepath"
	"testing"

	"owiki/internal/model"
)

func TestRenameAndDelete(t *testing.T) {
	repo, err := NewNoteRepo(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	const vid = int64(1)
	if err := repo.Upsert(ctx, &model.Note{VaultID: vid, Path: "a.md", Content: "hi", ContentHash: "x"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Rename(ctx, vid, "a.md", "b.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetByPath(ctx, vid, "a.md"); err != ErrNotFound {
		t.Fatalf("old path still there: %v", err)
	}
	got, err := repo.GetByPath(ctx, vid, "b.md")
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "hi" {
		t.Fatalf("content lost: %q", got.Content)
	}
	if err := repo.Rename(ctx, vid, "b.md", "b.md"); err == nil {
		t.Fatal("same-path rename should fail")
	}
	if err := repo.DeleteByPath(ctx, vid, "b.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetByPath(ctx, vid, "b.md"); err != ErrNotFound {
		t.Fatalf("delete missed: %v", err)
	}
}

func TestVaultIsolation(t *testing.T) {
	repo, err := NewNoteRepo(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	// 同一路径在两个 vault 各存一份，互不可见
	for _, vid := range []int64{1, 2} {
		if err := repo.Upsert(ctx, &model.Note{VaultID: vid, Path: "same.md", Content: "v" + string(rune('0'+vid)), ContentHash: "x"}); err != nil {
			t.Fatal(err)
		}
	}
	g1, err := repo.GetByPath(ctx, 1, "same.md")
	if err != nil {
		t.Fatal(err)
	}
	g2, err := repo.GetByPath(ctx, 2, "same.md")
	if err != nil {
		t.Fatal(err)
	}
	if g1.Content == g2.Content {
		t.Fatal("vaults should be isolated")
	}
	// 删 vault1 的文件不影响 vault2
	if err := repo.DeleteByPath(ctx, 1, "same.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetByPath(ctx, 2, "same.md"); err != nil {
		t.Fatal(err)
	}
}
