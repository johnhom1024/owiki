package agent

import (
	// AG-UI 官方社区 Go SDK：事件类型 + 构造器。
	// 只用定义层，SSE 编码见 emitter.go（官方 sse.SSEWriter）。
	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"
)

// aguiMapper 把一条 trpc-agent-go 事件转成 0..n 条 AG-UI 事件。
// 有状态：跨事件维护「当前轮」的 text/reasoning messageId，
// 按轮关闭消息，保证前端时间线分组正确。
type aguiMapper struct {
	runID    string
	threadID string

	seq        int // 服务端生成 id 的序号
	turn       int // LLM 轮次
	textID     string
	reasonID   string
	textOpen   bool
	reasonOpen bool
}

func newAGUIMapper(runID, threadID string) *aguiMapper {
	return &aguiMapper{runID: runID, threadID: threadID}
}

// nextID 服务端兜底 id（模型侧不带 id 时用）。
func (m *aguiMapper) nextID(prefix string) string {
	m.seq++
	id := m.runID + "-" + prefix + "-" + itoa(m.seq)
	return id
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// Started 发射 RUN_STARTED。
func (m *aguiMapper) Started() events.Event {
	return events.NewRunStartedEvent(m.threadID, m.runID)
}

// Finished 关闭未关的消息并发射 RUN_FINISHED（整个 run 的终结帧）。
func (m *aguiMapper) Finished() []events.Event {
	out := m.closeTurn()
	out = append(out, events.NewRunFinishedEvent(m.threadID, m.runID))
	return out
}

// closeTurn 关闭当前轮未关闭的消息，turn++。
func (m *aguiMapper) closeTurn() []events.Event {
	var out []events.Event
	if m.reasonOpen {
		out = append(out, events.NewReasoningMessageEndEvent(m.reasonID),
			events.NewReasoningEndEvent(m.reasonID))
		m.reasonOpen = false
		m.reasonID = ""
	}
	if m.textOpen {
		out = append(out, events.NewTextMessageEndEvent(m.textID))
		m.textOpen = false
		m.textID = ""
	}
	m.turn++
	return out
}

// Error 发射 RUN_ERROR。
func (m *aguiMapper) Error(msg string) events.Event {
	return events.NewRunErrorEvent(msg)
}

// errorPlaceholder runner 无正文错误时的兜底文案（与 ensureErrorEventContent 一致）。
const errorPlaceholder = "An error occurred during execution. Please contact the service provider."

// MapEvent trpc 事件 → AG-UI 事件序列。同一 delta 里 reasoning 先于 text。
func (m *aguiMapper) MapEvent(ev *aguiTrpcEvent) []events.Event {
	if ev == nil {
		return nil
	}
	var out []events.Event

	// 1) 错误事件
	if ev.err != nil {
		msg := ev.err.Type + ": " + ev.err.Message
		if ev.err.Type == "" {
			msg = ev.err.Message
		}
		if msg == "" {
			msg = errorPlaceholder
		}
		return []events.Event{m.Error(msg)}
	}

	// 2) 工具调用（模型侧要求）
	if ev.isToolCall {
		// 工具调用意味着本轮模型输出结束（有 tool_calls 时通常无正文）
		out = append(out, m.closeTurn()...)
		for _, tc := range ev.toolCalls {
			id := tc.id
			if id == "" {
				id = m.nextID("tool")
			}
			out = append(out,
				events.NewToolCallStartEvent(id, tc.name),
				events.NewToolCallArgsEvent(id, tc.args),
				events.NewToolCallEndEvent(id),
			)
		}
		return out
	}

	// 3) 工具结果（框架回填）
	if ev.isToolResult {
		id := ev.toolResultID
		if id == "" {
			id = m.nextID("tool")
		}
		out = append(out, events.NewToolCallResultEvent(id, id, ev.toolResultContent))
		return out
	}

	// 4) 用户消息回放（role=user 的完整 Message）
	if ev.isUser {
		id := m.nextID("user")
		return []events.Event{
			events.NewTextMessageStartEvent(id, events.WithRole("user")),
			events.NewTextMessageContentEvent(id, ev.text),
			events.NewTextMessageEndEvent(id),
		}
	}

	// 5) 收尾全文帧：直播流已被增量覆盖（textOpen 时跳过）；
	// 回放流只有这一份全文（mapper 状态全新），照常建消息。
	if ev.finalFullText != "" || ev.finalFullReasoning != "" {
		if m.textOpen {
			return nil // 直播：增量已发，跳过防重复
		}
		if ev.finalFullReasoning != "" {
			if !m.reasonOpen {
				m.reasonID = m.nextID("reason")
				out = append(out,
					events.NewReasoningStartEvent(m.reasonID),
					events.NewReasoningMessageStartEvent(m.reasonID, "reasoning"),
				)
				m.reasonOpen = true
			}
			out = append(out, events.NewReasoningMessageContentEvent(m.reasonID, ev.finalFullReasoning))
		}
		if ev.finalFullText != "" {
			if m.reasonOpen {
				out = append(out,
					events.NewReasoningMessageEndEvent(m.reasonID),
					events.NewReasoningEndEvent(m.reasonID),
				)
				m.reasonOpen = false
				m.reasonID = ""
			}
			m.textID = m.nextID("text")
			out = append(out, events.NewTextMessageStartEvent(m.textID, events.WithRole("assistant")))
			m.textOpen = true
			out = append(out, events.NewTextMessageContentEvent(m.textID, ev.finalFullText))
		}
		return out
	}

	// 6) 文本/reasoning 增量
	if ev.reasoning != "" {
		if !m.reasonOpen {
			m.reasonID = m.nextID("reason")
			out = append(out,
				events.NewReasoningStartEvent(m.reasonID),
				events.NewReasoningMessageStartEvent(m.reasonID, "reasoning"),
			)
			m.reasonOpen = true
		}
		out = append(out, events.NewReasoningMessageContentEvent(m.reasonID, ev.reasoning))
	}
	if ev.text != "" {
		if m.reasonOpen {
			// 正文开始 → reasoning 结束（DeepSeek：思考完才出正文）
			out = append(out,
				events.NewReasoningMessageEndEvent(m.reasonID),
				events.NewReasoningEndEvent(m.reasonID),
			)
			m.reasonOpen = false
			m.reasonID = ""
		}
		if !m.textOpen {
			m.textID = m.nextID("text")
			out = append(out, events.NewTextMessageStartEvent(m.textID, events.WithRole("assistant")))
			m.textOpen = true
		}
		out = append(out, events.NewTextMessageContentEvent(m.textID, ev.text))
	}
	return out
}

// aguiTrpcEvent trpc 事件的解构视图：aguiMapper 只看这些中立字段，
// 不直接依赖 trpc 类型——便于单测构造，也隔离上游 SDK 变化。
type aguiTrpcEvent struct {
	err              *aguiErr
	isToolCall       bool
	toolCalls        []aguiToolCall
	isToolResult     bool
	toolResultID     string
	toolResultContent string
	text              string
	reasoning         string
	isUser            bool
	finalFullText     string
	finalFullReasoning string
}

type aguiErr struct {
	Type    string
	Message string
}

type aguiToolCall struct {
	id   string
	name string
	args string
}

// NewToolCallStartEvent 的 parentMessageId 选项我们不用；TextMessageStart 的 role 选项：
const _ = "see events.WithRole / events.WithParentMessageId options"
