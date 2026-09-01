package service

import (
	"context"
	"path/filepath"
	"testing"

	"owiki/internal/repository"
)

func TestSaveOptimisticLockAndMerge(t *testing.T) {
	dir := t.TempDir()
	repo, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	first, err := Save(ctx, repo, SaveInput{Path: "a.md", Content: "line1\nline2\nline3\n", Mtime: 1})
	if err != nil {
		t.Fatal(err)
	}
	base := first.Note.ContentHash

	web, err := Save(ctx, repo, SaveInput{
		Path: "a.md", Content: "line1-web\nline2\nline3\n", Mtime: 2, BaseHash: base,
	})
	if err != nil {
		t.Fatal(err)
	}

	obs, err := Save(ctx, repo, SaveInput{
		Path: "a.md", Content: "line1\nline2\nline3-obs\n", Mtime: 3, BaseHash: base,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !obs.Merged {
		t.Fatal("expected auto merge")
	}
	if obs.Note.Content != "line1-web\nline2\nline3-obs\n" {
		t.Fatalf("merged content = %q", obs.Note.Content)
	}

	_, err = Save(ctx, repo, SaveInput{
		Path: "a.md", Content: "line1-web-again\nline2\nline3-obs\n", Mtime: 4, BaseHash: web.Note.ContentHash,
	})
	if err == nil {
		t.Fatal("expected conflict after overlapping edit")
	}
	if _, ok := err.(*ConflictError); !ok {
		t.Fatalf("got %T %v", err, err)
	}

	forced, err := Save(ctx, repo, SaveInput{
		Path: "a.md", Content: "forced\n", Mtime: 5, BaseHash: "stale", Force: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if forced.Note.Content != "forced\n" {
		t.Fatalf("force write failed: %q", forced.Note.Content)
	}
}
