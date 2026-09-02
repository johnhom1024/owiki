package repository

import (
	"context"
	"path/filepath"
	"testing"

	"owiki/internal/model"
)

func newTestVaultRepo(t *testing.T) (*VaultRepo, *NoteRepo) {
	t.Helper()
	noteRepo, err := NewNoteRepo(filepath.Join(t.TempDir(), "vault.db"))
	if err != nil {
		t.Fatalf("NewNoteRepo: %v", err)
	}
	vaultRepo, err := NewVaultRepo(noteRepo.DB())
	if err != nil {
		t.Fatalf("NewVaultRepo: %v", err)
	}
	return vaultRepo, noteRepo
}

func TestMigrateOrphanNotesSkipsEmptyDB(t *testing.T) {
	r, _ := newTestVaultRepo(t)
	ctx := context.Background()

	got, err := r.MigrateOrphanNotes(ctx, "legacy-token")
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("empty db should not create a vault, got %+v", got)
	}
	vs, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(vs) != 0 {
		t.Fatalf("want 0 vaults, got %d", len(vs))
	}
}

func TestMigrateOrphanNotesCreatesDefaultForLegacyNotes(t *testing.T) {
	r, notes := newTestVaultRepo(t)
	ctx := context.Background()

	if err := notes.Upsert(ctx, &model.Note{VaultID: 0, Path: "old.md", Content: "hi", ContentHash: "x"}); err != nil {
		t.Fatal(err)
	}

	got, err := r.MigrateOrphanNotes(ctx, "legacy-token")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("want a migrated vault")
	}
	if got.Name != "default" {
		t.Fatalf("name = %q", got.Name)
	}
	if got.Token != "legacy-token" {
		t.Fatalf("token = %q", got.Token)
	}

	n, err := notes.GetByPath(ctx, got.ID, "old.md")
	if err != nil {
		t.Fatal(err)
	}
	if n.VaultID != got.ID {
		t.Fatalf("note still orphaned: vault_id=%d", n.VaultID)
	}
}

func TestCreateMultipleVaults(t *testing.T) {
	r, _ := newTestVaultRepo(t)
	ctx := context.Background()

	a, err := r.Create(ctx, "个人笔记", "日常")
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.Create(ctx, "工作库", "")
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID {
		t.Fatal("vault ids should differ")
	}
	if a.Token == b.Token {
		t.Fatal("each vault should get its own token")
	}
	vs, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(vs) != 2 {
		t.Fatalf("want 2 vaults, got %d", len(vs))
	}
}
