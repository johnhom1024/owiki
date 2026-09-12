package agent

import (
	"bufio"
	"context"
	"strings"

	"github.com/gin-gonic/gin"

	agui "github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"
	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/encoding/sse"
	"trpc.group/trpc-go/trpc-agent-go/event"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
)

// destructureTrpc 把 trpc 事件解构成中立视图供 aguiMapper 消费。
// 屏蔽 trpc SDK 的 Choice/Delta 结构细节，mapEvents 的业务语义集中在这里。
func destructureTrpc(ev *event.Event) *aguiTrpcEvent {
	if ev == nil || ev.Response == nil {
		return nil
	}
	rsp := ev.Response
	out := &aguiTrpcEvent{}

	if rsp.Error != nil {
		out.err = &aguiErr{Type: rsp.Error.Type, Message: rsp.Error.Message}
		return out
	}

	if rsp.IsToolCallResponse() && len(rsp.Choices) > 0 {
		msg := rsp.Choices[0].Message
		if len(msg.ToolCalls) == 0 {
			msg = rsp.Choices[0].Delta
		}
		out.isToolCall = true
		for _, tc := range msg.ToolCalls {
			out.toolCalls = append(out.toolCalls, aguiToolCall{
				id:   tc.ID,
				name: tc.Function.Name,
				args: string(tc.Function.Arguments),
			})
		}
		return out
	}

	if rsp.IsToolResultResponse() && len(rsp.Choices) > 0 {
		msg := rsp.Choices[0].Message
		if msg.ToolID == "" {
			msg = rsp.Choices[0].Delta
		}
		out.isToolResult = true
		out.toolResultID = msg.ToolID
		out.toolResultContent = msg.Content
		return out
	}

	if len(rsp.Choices) > 0 {
		delta := rsp.Choices[0].Delta
		full := rsp.Choices[0].Message
		// 用户消息（role=user 的完整 Message）：直接透传（前端渲染到右侧）
		if full.Role == trpcmodel.RoleUser && full.Content != "" {
			out.isUser = true
			out.text = full.Content
			return out
		}
		// 流式增量优先
		out.text = delta.Content
		out.reasoning = delta.ReasoningContent
		// 收尾帧（Object=chat.completion）带全文 Message：直播时增量已发过，
		// 跳过防重复；回放时事件流里只有这一份全文（没有增量），必须采用。
		// 区分：全文帧在持久化流里 Delta 为空——用「事件序号内无同轮增量」
		// 判断不了，改由 mapper 的 closeTurn 语义兜底：直播流 delta 先到，
		// textOpen=true 时全文帧直接跳过（destructure 返回空）。
		if out.text == "" && out.reasoning == "" {
			if rsp.Object == trpcmodel.ObjectTypeChatCompletion {
				out.finalFullText = full.Content
				out.finalFullReasoning = full.ReasoningContent
			} else {
				out.text = full.Content
				out.reasoning = full.ReasoningContent
			}
		}
	}
	return out
}

// AgentEmitter 把 AG-UI 事件写进 gin 的 SSE 响应。
// 照官方 example emitter.go 的模式：首错即 no-op、传输错误取消 run。
type AgentEmitter struct {
	ctx    context.Context
	w      *bufio.Writer
	sse    *sse.SSEWriter
	cancel context.CancelFunc
	ginW   gin.ResponseWriter

	err    error // 首个传输错误（客户端断开）
	encErr error // 首个编码错误（丢事件不断流）
}

// NewAgentEmitter 绑定 gin ResponseWriter。cancel 可为 nil。
func NewAgentEmitter(ctx context.Context, gw gin.ResponseWriter, cancel context.CancelFunc) *AgentEmitter {
	bw := bufio.NewWriter(gw)
	return &AgentEmitter{
		ctx: ctx, w: bw, sse: sse.NewSSEWriter(),
		cancel: cancel, ginW: gw,
	}
}

// Write 写一条 AG-UI 事件（失败见结构注释）。
func (e *AgentEmitter) Write(ev agui.Event) {
	if e.err != nil {
		return
	}
	if err := e.sse.WriteEvent(e.ctx, e.w, ev); err != nil {
		if isTransportError(err) {
			e.err = err
			if e.cancel != nil {
				e.cancel()
			}
			return
		}
		if e.encErr == nil {
			e.encErr = err
		}
	}
}

// WriteAll 写一批。
func (e *AgentEmitter) WriteAll(evs []agui.Event) {
	for _, ev := range evs {
		e.Write(ev)
		if e.err != nil {
			return
		}
	}
}

// Flush 刷缓冲到连接（每个事件批次后调用）。
func (e *AgentEmitter) Flush() {
	if e.err != nil {
		return
	}
	_ = e.w.Flush()
	e.ginW.Flush()
}

// Err 传输错误（客户端已断开）。
func (e *AgentEmitter) Err() error { return e.err }

// EncErr 编码错误（事件被丢但流还在）。
func (e *AgentEmitter) EncErr() error { return e.encErr }

// isTransportError 与官方 example 保持一致的判定（错误串前缀来自
// pkg/encoding/sse/writer.go 的包装）。
func isTransportError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "SSE write failed") || strings.Contains(msg, "SSE flush failed")
}
