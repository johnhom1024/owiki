package agent

import (
	"bytes"
	"slices"
	"context"
	"encoding/json"
	"time"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"owiki/internal/feature"
	"owiki/internal/model"
	"owiki/internal/repository"
	"owiki/internal/tools"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// mockOpenAI 起一个假的 OpenAI 兼容端点：
// 第一轮返回带 tool_call 的消息；确认后续轮返回纯文本收尾。
// 脚本可注入。
func mockOpenAI(t *testing.T, script []string) *httptest.Server {
	t.Helper()
	i := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			http.NotFound(w, r)
			return
		}
		var req struct {
			Stream bool `json:"stream"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if i >= len(script) {
			i = 0
		}
		full := script[i]
		i++
		if !req.Stream {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, full)
			return
		}
		// 流式：把完整回复拆成 2 个 chunk 的 SSE
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		var parsed map[string]any
		_ = json.Unmarshal([]byte(full), &parsed)
		choices := parsed["choices"].([]any)
		c0 := choices[0].(map[string]any)
		msg := c0["message"].(map[string]any)
		content, _ := msg["content"].(string)
		if content == "" {
			// tool_call 回复：转成 delta.tool_calls 流式帧
			tcs := msg["tool_calls"].([]any)
			tc := tcs[0].(map[string]any)
			chunk := map[string]any{
				"id": "x", "object": "chat.completion.chunk", "created": 1, "model": "mock",
				"choices": []map[string]any{{
					"index": 0,
					"delta": map[string]any{
						"role": "assistant",
						"tool_calls": []map[string]any{{
							"index": 0,
							"id": tc["id"],
							"type": "function",
							"function": tc["function"],
						}},
					},
					"finish_reason": nil,
				}},
			}
			b, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\n", b)
			final := map[string]any{
				"id": "x", "object": "chat.completion.chunk", "created": 1, "model": "mock",
				"choices": []map[string]any{{
					"index": 0, "delta": map[string]any{}, "finish_reason": "tool_calls",
				}},
			}
			b, _ = json.Marshal(final)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", b)
			flusher.Flush()
			return
		}
		half := len([]rune(content)) / 2
		parts := []string{string([]rune(content)[:half]), string([]rune(content)[half:])}
		for idx, part := range parts {
			chunk := map[string]any{
				"id": "x", "object": "chat.completion.chunk", "created": 1, "model": "mock",
				"choices": []map[string]any{{
					"index": 0,
					"delta": map[string]any{"role": "assistant", "content": part},
					"finish_reason": nil,
				}},
			}
			b, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
			_ = idx
		}
		final := map[string]any{
			"id": "x", "object": "chat.completion.chunk", "created": 1, "model": "mock",
			"choices": []map[string]any{{
				"index": 0,
				"delta": map[string]any{},
				"finish_reason": "stop",
			}},
		}
		b, _ := json.Marshal(final)
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", b)
		flusher.Flush()
	}))
}

func plainReply(text string) string {
	b, _ := json.Marshal(map[string]any{
		"id": "x", "object": "chat.completion", "created": 1, "model": "mock",
		"choices": []map[string]any{{
			"index": 0, "finish_reason": "stop",
			"message": map[string]any{"role": "assistant", "content": text},
		}},
	})
	return string(b)
}

func toolCallReply(id, name, args string) string {
	b, _ := json.Marshal(map[string]any{
		"id": "x", "object": "chat.completion", "created": 1, "model": "mock",
		"choices": []map[string]any{{
			"index": 0, "finish_reason": "tool_calls",
			"message": map[string]any{
				"role": "assistant", "content": "",
				"tool_calls": []map[string]any{{
					"id": id, "type": "function",
					"function": map[string]any{"name": name, "arguments": args},
				}},
			},
		}},
	})
	return string(b)
}

func newTestRouter(t *testing.T, openaiURL string) (*gin.Engine, *Manager) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Setting{}, &model.ChatSession{}, &model.ChatEvent{}); err != nil {
		t.Fatal(err)
	}
	settingsRepo := repository.NewAISettingsRepo(db)
	store, err := repository.NewChatStore(db)
	if err != nil {
		t.Fatal(err)
	}
	// 一个无害的假工具（只读）
	reg, err := tools.NewRegistry(tools.Tool{
		Name: "echo", Description: "echo input",
		Flags: tools.FlagReadOnly,
		Input: struct {
			Text string `json:"text"`
		}{},
		Output: struct {
			Echo string `json:"echo"`
		}{},
		Handler: func(ctx context.Context, s *tools.Session, in json.RawMessage) (any, error) {
			var args struct{ Text string }
			_ = json.Unmarshal(in, &args)
			return map[string]any{"echo": args.Text}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	host := &tools.Host{}
	host.SetRegistryForTest(reg)
	mgr := NewManager(settingsRepo, host, store)
	// 配置 ready
	_ = settingsRepo.Update(context.Background(), func(a *model.AISettings) {
		a.Enabled = true
		a.BaseURL = openaiURL + "/v1"
		a.APIKey = "sk-mock"
		a.Model = "mock"
		a.LastTestOK = true
	})
	r := gin.New()
	api := r.Group("/api", func(c *gin.Context) { c.Next() })
	RegisterAPI(api, mgr, settingsRepo)
	return r, mgr
}

// TestE2EChatPlainRound 纯文本对话：start → token → done
func TestE2EChatPlainRound(t *testing.T) {
	oa := mockOpenAI(t, []string{plainReply("你好，笔记库共 3 篇")})
	defer oa.Close()
	r, _ := newTestRouter(t, oa.URL)

	body, _ := json.Marshal(map[string]string{"message": "库里有几篇笔记？"})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/s1/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	sse := w.Body.String()
	types := aguiTypes(sse)
	for _, want := range []string{"RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED"} {
		if !slices.Contains(types, want) {
			t.Errorf("SSE missing %q in:\n%s", want, sse)
		}
	}
	if got := aguiText(sse); got != "你好，笔记库共 3 篇" {
		t.Errorf("text = %q, sse:\n%s", got, sse)
	}
	if n := strings.Count(sse, "\"TEXT_MESSAGE_START\""); n != 1 {
		t.Errorf("expected exactly 1 TEXT_MESSAGE_START, got %d: %s", n, sse)
	}
}

// aguiText 从 AG-UI SSE 流提取 TEXT_MESSAGE_CONTENT 拼接的全文。
func aguiText(sse string) string {
	var out strings.Builder
	for _, line := range strings.Split(sse, "\n") {
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(line[5:])), &m); err != nil {
			continue
		}
		if m["type"] == "TEXT_MESSAGE_CONTENT" {
			if d, ok := m["delta"].(string); ok {
				out.WriteString(d)
			}
		}
	}
	return out.String()
}

// aguiTypes 从 AG-UI SSE 流提取事件 type 序列。
func aguiTypes(sse string) []string {
	var out []string
	for _, line := range strings.Split(sse, "\n") {
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(line[5:])), &m); err != nil {
			continue
		}
		if t, ok := m["type"].(string); ok {
			out = append(out, t)
		}
	}
	return out
}

// TestE2EChatToolRound 工具调用循环：tool_call → tool_result → 最终文本
func TestE2EChatToolRound(t *testing.T) {
	oa := mockOpenAI(t, []string{
		toolCallReply("call-1", "echo", `{"text":"hi"}`),
		plainReply("完成"),
	})
	defer oa.Close()
	r, _ := newTestRouter(t, oa.URL)

	body, _ := json.Marshal(map[string]string{"message": "echo hi"})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/s1/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	sse := w.Body.String()
	types := aguiTypes(sse)
	for _, want := range []string{"TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT"} {
		if !slices.Contains(types, want) {
			t.Errorf("missing %s:\n%s", want, sse)
		}
	}
	if got := aguiText(sse); got != "完成" {
		t.Errorf("missing final text (got %q):\n%s", got, sse)
	}
}

func openaiErrorReply(message string) string {
	b, _ := json.Marshal(map[string]any{
		"error": map[string]any{"message": message, "type": "server_error"},
	})
	return string(b)
}

func mockOpenAIError(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		fmt.Fprint(w, body)
	}))
}

// TestE2EChatProviderError 上游失败必须走 error 帧，不能把 runner 占位英文当 token。
func TestE2EChatProviderError(t *testing.T) {
	oa := mockOpenAIError(t, 500, openaiErrorReply("no healthy upstream"))
	defer oa.Close()
	r, _ := newTestRouter(t, oa.URL)

	body, _ := json.Marshal(map[string]string{"message": "hi"})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/s-err/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	sse := w.Body.String()
	if !slices.Contains(aguiTypes(sse), "RUN_ERROR") {
		t.Fatalf("missing RUN_ERROR:\n%s", sse)
	}
	if slices.Contains(aguiTypes(sse), "TEXT_MESSAGE_START") {
		t.Fatalf("error path must not emit text message:\n%s", sse)
	}
}

// TestE2ENotReady503 未配置/未测通：流端点 503
func TestE2ENotReady503(t *testing.T) {
	oa := mockOpenAI(t, nil)
	defer oa.Close()
	r, mgr := newTestRouter(t, oa.URL)
	// 清掉配置
	_ = mgr.settings.Update(context.Background(), func(a *model.AISettings) {
		a.APIKey = ""
	})

	body, _ := json.Marshal(map[string]string{"message": "hi"})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/s1/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

// TestE2ESettingsLifecycle 配置生命周期：保存（空 key 保留）→ 测试回写 ready
func TestE2ESettingsLifecycle(t *testing.T) {
	oa := mockOpenAI(t, []string{plainReply("pong")})
	defer oa.Close()
	r, _ := newTestRouter(t, oa.URL)

	// 读初始
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/chat/settings", nil))
	var got struct {
		Ready     bool   `json:"ready"`
		ApiKeySet bool   `json:"apiKeySet"`
		BaseURL   string `json:"baseUrl"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if !got.Ready || !got.ApiKeySet || got.BaseURL == "" {
		t.Fatalf("initial settings wrong: %+v", got)
	}

	// 空 key 保存：key 不丢
	body, _ := json.Marshal(map[string]any{"enabled": true, "baseUrl": got.BaseURL, "model": "mock", "apiKey": ""})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/chat/settings", bytes.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("put failed: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/chat/settings", nil))
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if !got.ApiKeySet {
		t.Fatal("empty apiKey on save must keep stored key")
	}
}

// TestE2EFeatureDisabled feature 关 → 路由组 404（在 RegisterAPI 外层套 Require 的行为验证）
func TestE2EFeatureDisabled(t *testing.T) {
	oa := mockOpenAI(t, nil)
	defer oa.Close()
	r, _ := newTestRouter(t, oa.URL)

	feature.Register(feature.Desc{ID: "chat-e2e", Default: true, CanToggle: true})
	feature.Use().SetEnabled("chat-e2e", false)
	gated := r.Group("/gated", feature.Require("chat-e2e"))
	gated.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/gated/ping", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when feature off, got %d", w.Code)
	}
	feature.Use().SetEnabled("chat-e2e", true)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/gated/ping", nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 when feature on, got %d", w.Code)
	}
}

// TestE2EConfirmFlow 危险工具确认流：
// tool_call(danger) → SSE confirm 帧 → Resolve(approve) → 工具执行 → 收尾
func TestE2EConfirmFlow(t *testing.T) {
	oa := mockOpenAI(t, []string{
		toolCallReply("call-9", "danger", `{"path":"x.md"}`),
		plainReply("已删除"),
	})
	defer oa.Close()
	r, mgr := newTestRouterWithDestructive(t, oa.URL)

	// 后台：等 broker 挂起后模拟用户点「允许」
	resolved := make(chan struct{})
	go func() {
		defer close(resolved)
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			ids := mgr.Broker().PendingIDs()
			if len(ids) > 0 {
				if dangerExecuted() {
					t.Error("tool must not execute before approval")
				}
				mgr.Broker().Resolve(ids[0], true)
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()

	body, _ := json.Marshal(map[string]string{"message": "删掉 x.md"})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/sc/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	<-resolved

	sse := w.Body.String()
	if !strings.Contains(sse, "\"name\":\"tool_confirm\"") {
		t.Errorf("missing tool_confirm custom event:\n%s", sse)
	}
	if got := aguiText(sse); got != "已删除" {
		t.Errorf("missing final text after approval (got %q):\n%s", got, sse)
	}
	if !dangerExecuted() {
		t.Error("destructive tool should have executed after approval")
	}
}


// danger 破坏性假工具的执行标记（包级变量供 goroutine 断言）。
var dangerRan bool

func dangerExecuted() bool { return dangerRan }

// newTestRouterWithDestructive 在 newTestRouter 基础上多挂一个
// FlagDestructive 工具，验证确认流拦截。
func newTestRouterWithDestructive(t *testing.T, openaiURL string) (*gin.Engine, *Manager) {
	t.Helper()
	r, mgr := newTestRouter(t, openaiURL)
	reg, err := tools.NewRegistry(tools.Tool{
		Name: "danger", Description: "destructive for test",
		Flags: tools.FlagDestructive,
		Input: struct {
			Path string `json:"path"`
		}{},
		Handler: func(ctx context.Context, s *tools.Session, in json.RawMessage) (any, error) {
			dangerRan = true
			return map[string]any{"deleted": true}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	mgr.host.SetRegistryForTest(reg)
	// 配置变了 runner 要重建
	mgr.Invalidate()
	return r, mgr
}
