package repository

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newTestShareRepo(t *testing.T) *ShareRepo {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "share.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	r, err := NewShareRepo(db)
	if err != nil {
		t.Fatalf("NewShareRepo: %v", err)
	}
	return r
}

func TestShareGetOrCreateStableToken(t *testing.T) {
	r := newTestShareRepo(t)
	ctx := context.Background()

	s1, err := r.GetOrCreateByNoteID(ctx, 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if s1.Enabled {
		t.Fatal("new share should start disabled")
	}
	if len(s1.Token) != 8 {
		t.Fatalf("token want 8 chars, got %q", s1.Token)
	}

	// 再次获取：token 不变（关掉再开 URL 稳定）
	s2, err := r.GetOrCreateByNoteID(ctx, 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if s2.Token != s1.Token {
		t.Fatalf("token changed: %s -> %s", s1.Token, s2.Token)
	}
}

func TestShareEnableDisable(t *testing.T) {
	r := newTestShareRepo(t)
	ctx := context.Background()

	if _, err := r.GetOrCreateByNoteID(ctx, 2, 200); err != nil {
		t.Fatal(err)
	}
	s, err := r.SetEnabled(ctx, 200, true)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Enabled {
		t.Fatal("should be enabled")
	}
	// 开启后 token 可查
	if _, err := r.GetByToken(ctx, s.Token); err != nil {
		t.Fatalf("GetByToken after enable: %v", err)
	}
	// 关闭后立即 404
	if _, err := r.SetEnabled(ctx, 200, false); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByToken(ctx, s.Token); err != ErrShareNotFound {
		t.Fatalf("GetByToken after disable want ErrShareNotFound, got %v", err)
	}
}

func TestShareDeleteCleanup(t *testing.T) {
	r := newTestShareRepo(t)
	ctx := context.Background()

	s, _ := r.GetOrCreateByNoteID(ctx, 3, 300)
	_, _ = r.SetEnabled(ctx, 300, true)
	// vault 2 的记录不应被波及
	other, _ := r.GetOrCreateByNoteID(ctx, 2, 200)
	_, _ = r.SetEnabled(ctx, 200, true)

	if err := r.DeleteByNoteID(ctx, 300); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByNoteID(ctx, 300); err != ErrShareNotFound {
		t.Fatalf("want ErrShareNotFound after delete, got %v", err)
	}
	if _, err := r.GetByToken(ctx, s.Token); err != ErrShareNotFound {
		t.Fatal("deleted share token should not resolve")
	}

	if err := r.DeleteByVault(ctx, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByToken(ctx, other.Token); err != ErrShareNotFound {
		t.Fatal("vault cleanup should remove shares")
	}
}
