package agent

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"trpc.group/trpc-go/trpc-agent-go/event"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
)

// sseEvent 映射后的 SSE 帧名与载荷。
type sseEvent struct {
	name string
	data any
}

// mapEvents 把一条 trpc 事件转成 0..n 个 SSE 帧。
// 前端契约：start / token / tool_call / tool_result / confirm / done / error。
func mapEvents(runID string, ev *event.Event) []sseEvent {
	if ev == nil || ev.Response == nil {
		// confirm 请求不走 model 响应（BeforeToolCallback 里直接推），
		// trpc 事件流里没有对应物——由 broker 的 Pending 机制配合前端轮询。
		return nil
	}
	rsp := ev.Response
	var out []sseEvent

	// 工具调用（模型要求调工具）
	if rsp.IsToolCallResponse() && len(rsp.Choices) > 0 {
		msg := rsp.Choices[0].Message
		if len(msg.ToolCalls) == 0 {
			msg = rsp.Choices[0].Delta
		}
		for _, tc := range msg.ToolCalls {
			out = append(out, sseEvent{"tool_call", gin.H{
				"runId": runID, "id": tc.ID, "name": tc.Function.Name,
				"arguments": string(tc.Function.Arguments),
			}})
		}
		return out
	}

	// 工具结果（框架回填后的 tool response）
	if rsp.IsToolResultResponse() && len(rsp.Choices) > 0 {
		msg := rsp.Choices[0].Message
		if msg.ToolID == "" {
			msg = rsp.Choices[0].Delta
		}
		content := msg.Content
		out = append(out, sseEvent{"tool_result", gin.H{
			"runId": runID, "toolId": msg.ToolID, "toolName": msg.ToolName,
			"content": truncateTail(content, 4000),
		}})
		return out
	}

	// 文本 token：流式增量走 Delta；openai 流结束还会再发一帧
	// Object=chat.completion 带全文 Message——跳过，避免前端把答案拼两遍。
	if len(rsp.Choices) > 0 {
		delta := rsp.Choices[0].Delta
		msg := rsp.Choices[0].Message
		text := delta.Content
		if text == "" && rsp.Object != trpcmodel.ObjectTypeChatCompletion {
			text = msg.Content
		}
		if text != "" {
			out = append(out, sseEvent{"token", gin.H{
				"runId": runID, "text": text, "partial": rsp.IsPartial,
			}})
		}
	}
	return out
}

// replayableEvent 历史回放时只挑用户可见的事件。
func replayableEvent(e event.Event) *sseEvent {
	runID := ""
	switch {
	case e.Response != nil && e.Response.IsToolCallResponse():
		return &sseEvent{name: "tool_call", data: nil} // 简化：回放不带参数细节
	case e.Response != nil && e.Response.IsToolResultResponse():
		return &sseEvent{name: "tool_result", data: nil}
	case e.Response != nil && len(e.Response.Choices) > 0:
		msg := e.Response.Choices[0].Message
		if msg.Content != "" {
			return &sseEvent{name: "message", data: gin.H{
				"role": string(msg.Role), "text": msg.Content,
			}}
		}
	}
	_ = runID
	return nil
}

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
