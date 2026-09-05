package openapi

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"owiki/internal/hub"
	"owiki/internal/model"
	"owiki/internal/repository"
)

func waitMsg(t *testing.T, c *hub.Client, timeout time.Duration) []byte {
	t.Helper()
	select {
	case msg := <-c.Send:
		return msg
	case <-time.After(timeout):
		t.Fatal("timed out waiting for broadcast")
		return nil
	}
}

func TestRenameNoteBroadcastsFromTo(t *testing.T) {
	dir := t.TempDir()
	repo, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(dir, "att"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	const vid int64 = 7
	if err := repo.Upsert(ctx, &model.Note{VaultID: vid, Path: "old.md", Content: "hi", ContentHash: "x"}); err != nil {
		t.Fatal(err)
	}

	h := hub.New()
	c := &hub.Client{
		Send:        make(chan []byte, 4),
		VaultID:     vid,
		SyncEnabled: true,
	}
	h.Register(c)

	if err := RenameNote(ctx, repo, attach, nil, h, vid, "old.md", "new.md", repository.SourceOpenAPI, "test"); err != nil {
		t.Fatal(err)
	}

	raw := waitMsg(t, c, time.Second)
	var msg map[string]string
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("broadcast not json: %s", raw)
	}
	if msg["type"] != "renamed" || msg["from"] != "old.md" || msg["to"] != "new.md" {
		t.Fatalf("want renamed from=old.md to=new.md, got %s", raw)
	}
	if _, hasPath := msg["path"]; hasPath {
		t.Fatalf("renamed broadcast must not use path field (plugin treats missing from/to as no-op): %s", raw)
	}

	if _, err := repo.GetByPath(ctx, vid, "old.md"); err != repository.ErrNotFound {
		t.Fatalf("old path still on server: %v", err)
	}
	if _, err := repo.GetByPath(ctx, vid, "new.md"); err != nil {
		t.Fatalf("new path missing: %v", err)
	}
}

func TestDeleteNoteBroadcastsPath(t *testing.T) {
	dir := t.TempDir()
	repo, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(dir, "att"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	const vid int64 = 8
	if err := repo.Upsert(ctx, &model.Note{VaultID: vid, Path: "gone.md", Content: "x", ContentHash: "x"}); err != nil {
		t.Fatal(err)
	}

	h := hub.New()
	c := &hub.Client{
		Send:        make(chan []byte, 4),
		VaultID:     vid,
		SyncEnabled: true,
	}
	h.Register(c)

	if err := DeleteNote(ctx, repo, attach, nil, nil, h, vid, "gone.md", 0, repository.SourceOpenAPI, "test"); err != nil {
		t.Fatal(err)
	}
	raw := waitMsg(t, c, time.Second)
	var msg map[string]string
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("broadcast not json: %s", raw)
	}
	if msg["type"] != "deleted" || msg["path"] != "gone.md" {
		t.Fatalf("want deleted path=gone.md, got %s", raw)
	}
}
