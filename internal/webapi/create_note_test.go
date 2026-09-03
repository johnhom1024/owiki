package webapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"owiki/internal/events"
	"owiki/internal/hub"
	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
)

func setupCreateNote(t *testing.T) (*gin.Engine, int64, *repository.NoteRepo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	repo, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	vaultRepo, err := repository.NewVaultRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	deviceRepo, err := repository.NewDeviceRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	syncLog, err := repository.NewSyncLogRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	share, err := repository.NewShareRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(dir, "att"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := vaultRepo.Create(context.Background(), "test", "")
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	api := r.Group("/api")
	RegisterVaultRoutes(api, vaultRepo, repo, deviceRepo, hub.New(), events.NewHub(), attach, syncLog, share)
	return r, v.ID, repo
}

func TestCreateNoteFromWeb(t *testing.T) {
	r, vid, repo := setupCreateNote(t)

	body, _ := json.Marshal(map[string]string{"path": "日记/今日"})
	req := httptest.NewRequest(http.MethodPost, "/api/vaults/"+strconv.FormatInt(vid, 10)+"/files", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			ID      int64  `json:"id"`
			Path    string `json:"path"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.ID == 0 || resp.Data.Path != "日记/今日.md" {
		t.Fatalf("unexpected note: %+v", resp.Data)
	}
	if resp.Data.Content != "# 今日\n" {
		t.Fatalf("content = %q", resp.Data.Content)
	}
	got, err := repo.GetByPath(context.Background(), vid, "日记/今日.md")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != resp.Data.ID {
		t.Fatalf("id mismatch %d vs %d", got.ID, resp.Data.ID)
	}

	// 同路径再建 → 409
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/vaults/"+strconv.FormatInt(vid, 10)+"/files", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("dup status = %d body = %s", w2.Code, w2.Body.String())
	}
}

func TestCreateNoteRejectsAttachment(t *testing.T) {
	r, vid, _ := setupCreateNote(t)
	body, _ := json.Marshal(map[string]string{"path": "img.png"})
	req := httptest.NewRequest(http.MethodPost, "/api/vaults/"+strconv.FormatInt(vid, 10)+"/files", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
	}
}
