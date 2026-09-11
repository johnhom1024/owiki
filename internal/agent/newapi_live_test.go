package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	owikimodel "owiki/internal/model"
)

// 默认打家里 NAS 上的 new-api（与设置页实测同一套）。
// 外网/无 NAS 时：
//
//	go test ./internal/agent -run TestLiveNewAPI -count=1
//
// 会 Skip。覆盖端点：
//
//	OWIKI_LIVE_BASEURL / OWIKI_LIVE_APIKEY / OWIKI_LIVE_MODEL
const (
	liveDefaultBase  = "http://192.168.31.229:3004/v1"
	liveDefaultKey   = "sk-XrnCMAtXwtBJcOwNa59U5jV2EhTk0aWNjEf3zEq6UICsjKFK"
	liveDefaultModel = "new-combo"
)

func liveCreds() (base, key, model string) {
	base = os.Getenv("OWIKI_LIVE_BASEURL")
	if base == "" {
		base = liveDefaultBase
	}
	key = os.Getenv("OWIKI_LIVE_APIKEY")
	if key == "" {
		key = liveDefaultKey
	}
	model = os.Getenv("OWIKI_LIVE_MODEL")
	if model == "" {
		model = liveDefaultModel
	}
	return
}

func skipIfNewAPIDown(t *testing.T, base, key string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Skipf("new-api unreachable (%s): %v", base, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Skipf("new-api %s returned %s", base, resp.Status)
	}
}

// TestLiveNewAPIChatCompletions 裸 HTTP 打 new-api，确认端点/key/模型本身通。
func TestLiveNewAPIChatCompletions(t *testing.T) {
	base, key, model := liveCreds()
	skipIfNewAPIDown(t, base, key)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := testConnection(ctx, base, key, model); err != nil {
		t.Fatalf("chat/completions via %s model=%s: %v", base, model, err)
	}
}

// TestLiveNewAPIAgentStream 走完整 runner+SSE：new-api 必须给出非错误 token。
func TestLiveNewAPIAgentStream(t *testing.T) {
	base, key, model := liveCreds()
	skipIfNewAPIDown(t, base, key)

	r, mgr := newTestRouter(t, "http://unused.invalid")
	if err := mgr.settings.Update(context.Background(), func(a *owikimodel.AISettings) {
		a.Enabled = true
		a.BaseURL = base
		a.APIKey = key
		a.Model = model
		a.LastTestOK = true
	}); err != nil {
		t.Fatal(err)
	}
	mgr.Invalidate()

	body, _ := json.Marshal(map[string]string{"message": "只回一个字：好"})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/live-newapi/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.ServeHTTP(w, req)
	}()
	select {
	case <-done:
	case <-time.After(45 * time.Second):
		t.Fatal("stream timed out")
	}

	sse := w.Body.String()
	t.Logf("SSE:\n%s", sse)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, sse)
	}
	if strings.Contains(sse, "event:error") {
		t.Fatalf("stream error (new-api/runner 未打通):\n%s", sse)
	}
	if !strings.Contains(sse, "event:token") {
		t.Fatalf("no token from new-api:\n%s", sse)
	}
	if concatTokens(sse) == "" {
		t.Fatalf("empty tokens:\n%s", sse)
	}
}
