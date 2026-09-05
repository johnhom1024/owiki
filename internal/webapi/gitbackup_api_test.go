package webapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"owiki/internal/events"
	"owiki/internal/feature"
	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
)

// gitbackup API 集成测试：feature 门禁 + 配置 CRUD + token 掩码 + run 校验。
func setupGitBackupTest(t *testing.T) (*gin.Engine, *repository.GitBackupRepo, *repository.VaultRepo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	gbRepo, err := repository.NewGitBackupRepo(db.DB())
	if err != nil {
		t.Fatal(err)
	}
	vaultRepo, err := repository.NewVaultRepo(db.DB())
	if err != nil {
		t.Fatal(err)
	}
	// 测试 vault
	if _, err := vaultRepo.Create(context.Background(), "t", ""); err != nil {
		t.Fatal(err)
	}

	feature.Use().SetEnabled("gitbackup", true)
	t.Cleanup(func() { feature.Use().SetEnabled("gitbackup", false) })

	r := gin.New()
	api := r.Group("/api")
	RegisterGitBackupRoutes(api, gbRepo, nil, vaultRepo, events.NewHub())
	return r, gbRepo, vaultRepo
}

func putBody(t *testing.T, body any) []byte {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// feature 关闭时路由 404；开启后 GET 返回默认配置（token 掩码）。
func TestGitBackupFeatureGateAndDefaults(t *testing.T) {
	r, _, _ := setupGitBackupTest(t)

	feature.Use().SetEnabled("gitbackup", false)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/vaults/1/git-backup", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("feature off should 404, got %d", w.Code)
	}

	feature.Use().SetEnabled("gitbackup", true)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/vaults/1/git-backup", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Branch      string `json:"branch"`
			DebounceSec int    `json:"debounceSec"`
			Enabled     bool   `json:"enabled"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Branch != "main" || resp.Data.DebounceSec != 15 || resp.Data.Enabled {
		t.Fatalf("defaults: %+v", resp.Data)
	}
}

// PUT 保存配置 + token 掩码回显 + 未配置 remote 时拒绝开启。
func TestGitBackupPutConfig(t *testing.T) {
	r, gbRepo, _ := setupGitBackupTest(t)

	// 1) 开启但没 remote：400
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/api/vaults/1/git-backup", bytes.NewReader(putBody(t, map[string]any{"enabled": true})))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("enable without remote should 400, got %d body=%s", w.Code, w.Body.String())
	}

	// 2) 完整配置
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/api/vaults/1/git-backup", bytes.NewReader(putBody(t, map[string]any{
		"remoteUrl":   "https://github.com/user/vault-backup.git",
		"branch":      "main",
		"token":       "ghp_secret_token_xxx",
		"debounceSec": 30,
		"enabled":     true,
	})))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT status = %d body=%s", w.Code, w.Body.String())
	}
	// 响应里 token 是掩码
	var resp struct {
		Data struct {
			Token string `json:"token"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Token == "ghp_secret_token_xxx" {
		t.Fatal("token must be masked in response")
	}
	if resp.Data.Token != "•••••" {
		t.Fatalf("want masked token, got %q", resp.Data.Token)
	}

	// 3) DB 里存的是明文（服务端要用）
	b, err := gbRepo.GetByVault(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if b.Token != "ghp_secret_token_xxx" {
		t.Fatalf("db token = %q", b.Token)
	}
	if !b.Enabled || b.DebounceSec != 30 {
		t.Fatalf("saved config: %+v", b)
	}

	// 4) token 空串 = 保持不变
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/api/vaults/1/git-backup", bytes.NewReader(putBody(t, map[string]any{"debounceSec": 60})))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("token-keep PUT status = %d", w.Code)
	}
	b, _ = gbRepo.GetByVault(context.Background(), 1)
	if b.Token != "ghp_secret_token_xxx" || b.DebounceSec != 60 {
		t.Fatalf("token should be kept: %+v", b)
	}
}

// 非 https remote 拒绝；refs/heads/ 前缀的分支名会被洗掉。
func TestGitBackupValidation(t *testing.T) {
	r, gbRepo, _ := setupGitBackupTest(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/api/vaults/1/git-backup", bytes.NewReader(putBody(t, map[string]any{
		"remoteUrl": "git@github.com:user/repo.git", "enabled": true,
	})))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("ssh remote should 400, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/api/vaults/1/git-backup", bytes.NewReader(putBody(t, map[string]any{
		"remoteUrl": "https://github.com/u/r.git", "branch": "refs/heads/backup", "enabled": true,
	})))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("branch sanitize PUT status = %d", w.Code)
	}
	b, _ := gbRepo.GetByVault(context.Background(), 1)
	if b.Branch != "backup" {
		t.Fatalf("branch = %q", b.Branch)
	}
}

// run：未开启 400（mgr 未装配时 503 优先——校验顺序：先 manager 后 enabled）。
func TestGitBackupRunRequiresEnabled(t *testing.T) {
	r, _, _ := setupGitBackupTest(t)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/api/vaults/1/git-backup/run", nil))
	// mgr=nil（Manager 未装配）且备份未开启：503 或 400 都算「被拒」
	if w.Code != http.StatusBadRequest && w.Code != http.StatusServiceUnavailable {
		t.Fatalf("run without enable should be rejected, got %d body=%s", w.Code, w.Body.String())
	}
}

// 不存在的 vault：404（与 vault_api 一致语义）。
func TestGitBackupVaultNotFound(t *testing.T) {
	r, _, _ := setupGitBackupTest(t)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/vaults/999/git-backup", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown vault should 404, got %d", w.Code)
	}
}
