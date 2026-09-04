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

// feature API + share 门禁集成测试：开关切换 → 路由 404 → SSE 广播。
func setupFeatureTest(t *testing.T) (*gin.Engine, *repository.SettingRepo, *events.Hub) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	shareRepo, err := repository.NewShareRepo(db.DB())
	if err != nil {
		t.Fatal(err)
	}
	settingRepo, err := repository.NewSettingRepo(db.DB())
	if err != nil {
		t.Fatal(err)
	}
	eventHub := events.NewHub()

	r := gin.New()
	api := r.Group("/api")
	RegisterFeatureAPI(api, settingRepo, eventHub)
	RegisterShareRoutes(api, r, db, shareRepo, nil)
	return r, settingRepo, eventHub
}

// GET /api/features 列出全部功能；PUT 切换后立即生效并持久化。
func TestFeatureAPIListAndToggle(t *testing.T) {
	r, settingRepo, eventHub := setupFeatureTest(t)

	// 订阅 SSE：PUT 后应收到 feature.changed
	sub := eventHub.Subscribe()
	defer eventHub.Unsubscribe(sub)

	// 1) list
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/features", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("list status = %d", w.Code)
	}
	var listResp struct {
		Data []feature.StateDesc
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listResp); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, f := range listResp.Data {
		ids[f.ID] = true
	}
	for _, want := range []string{"share", "synclog", "apikeys"} {
		if !ids[want] {
			t.Fatalf("feature %s missing from list", want)
		}
	}

	// 2) toggle share off → 公开路由立即 404
	body, _ := json.Marshal(map[string]bool{"enabled": false})
	w = httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/api/features/share", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("toggle status = %d body=%s", w.Code, w.Body.String())
	}

	// 公开分享路由：畸形 token 400 vs feature 关闭 404——
	// 门禁在路由组上，先于参数校验，直接 404
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/share/aaaaaaaa", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("share route should 404 when disabled, got %d body=%s", w.Code, w.Body.String())
	}

	// 3) SSE 事件已广播
	select {
	case ev := <-sub:
		if ev.Type != "feature.changed" || ev.Path != "share" {
			t.Fatalf("unexpected event: %+v", ev)
		}
	default:
		t.Fatal("no feature.changed event")
	}

	// 4) 持久化验证：settings 表有记录
	v, ok, err := settingRepo.Get(context.Background(), feature.SettingKey("share"))
	if err != nil || !ok || v != "false" {
		t.Fatalf("settings row = %q ok=%v err=%v", v, ok, err)
	}

	// 5) 重新开启 → 路由复活（token 校验逻辑回到 handler）
	body, _ = json.Marshal(map[string]bool{"enabled": true})
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/api/features/share", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("re-enable status = %d", w.Code)
	}
	// 有效形状但未知的 token：进入 handler，404（分享不存在）
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/share/aaaaaaaa", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown token should 404 in handler, got %d", w.Code)
	}
	// 恢复默认，避免污染其他测试
	feature.Use().SetEnabled("share", true)
}

// canToggle=false 的核心功能 PUT 被拒。
func TestFeatureAPICoreNotToggleable(t *testing.T) {
	feature.Register(feature.Desc{ID: "test-core", Default: true, CanToggle: false})
	r, _, _ := setupFeatureTest(t)

	body, _ := json.Marshal(map[string]bool{"enabled": false})
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/api/features/test-core", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("core toggle should 400, got %d", w.Code)
	}
}

// 重启语义：LoadSettings 读回 DB 值，用户动过的开关不跳回 env/默认。
func TestFeatureRestartSemantics(t *testing.T) {
	_, _, _ = setupFeatureTest(t)

	// 模拟用户关掉 share（上面已验证持久化路径），重启进程后：
	feature.Use().LoadSettings(map[string]string{
		feature.SettingKey("share"): "false",
	}, func(string) string { return "" })
	if feature.Use().Enabled("share") {
		t.Fatal("restart should keep user value")
	}
	feature.Use().SetEnabled("share", true) // 清理
}
