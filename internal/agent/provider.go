package agent

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// testConnection 用 OpenAI 兼容端点打一次最小请求。
// 直接裸 HTTP（不引 llmagent）：max_tokens=1 非流式 chat/completions。
func testConnection(ctx context.Context, baseURL, apiKey, mdl string) error {
	u := strings.TrimRight(baseURL, "/") + "/chat/completions"
	if !strings.Contains(u, "/v1/chat/completions") && !strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/v1") {
		// BaseURL 未带 /v1 时按惯例补（Ollama/vLLM/DeepSeek 的文档形态）
		if !strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/v1") {
			u = strings.TrimRight(baseURL, "/") + "/v1/chat/completions"
		}
	}
	body := fmt.Sprintf(`{"model":%q,"max_tokens":1,"messages":[{"role":"user","content":"ping"}]}`, mdl)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req = req.WithContext(cctx)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("provider returned %s: %s", resp.Status, string(b))
	}
	return nil
}

func truncateTail(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
