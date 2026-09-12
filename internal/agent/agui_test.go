package agent

import (
	agui "github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"
	"context"
	"encoding/json"
	"testing"
	"time"

	"trpc.group/trpc-go/trpc-agent-go/event"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
)

// typesOf 提取事件序列的 type 列表，便于断言。
func typesOf(evs []agui.Event) []string {
	out := make([]string, 0, len(evs))
	for _, e := range evs {
		out = append(out, string(e.Type()))
	}
	return out
}

func eq(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("sequence:\n got %v\nwant %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("sequence[%d]:\n got %v\nwant %v", i, got, want)
		}
	}
}

// 纯文本一轮：START → CONTENT* → RUN_FINISHED 时 END
func TestAGUIPlainTextSequence(t *testing.T) {
	m := newAGUIMapper("run1", "s1")
	m.Started() // RUN_STARTED
	var seq []string
	seq = append(seq, "RUN_STARTED")

	chunk := func(text string) *event.Event {
		return &event.Event{Response: &trpcmodel.Response{
			Object:    trpcmodel.ObjectTypeChatCompletionChunk,
			IsPartial: true,
			Choices:   []trpcmodel.Choice{{Delta: trpcmodel.Message{Content: text}}},
		}}
	}
	for _, evs := range [][]*event.Event{{chunk("你"), chunk("好")}} {
		for _, e := range evs {
			for _, ae := range m.MapEvent(destructureTrpc(e)) {
				seq = append(seq, string(ae.Type()))
			}
		}
	}
	seq = append(seq, typesOf(m.Finished())...)
	eq(t, seq, []string{
		"RUN_STARTED",
		"TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT",
		"TEXT_MESSAGE_END", "RUN_FINISHED",
	})
}

// reasoning → 正文：REASONING 组先开先关
func TestAGUIReasoningThenText(t *testing.T) {
	m := newAGUIMapper("run2", "s2")
	rc := &event.Event{Response: &trpcmodel.Response{
		Object:  trpcmodel.ObjectTypeChatCompletionChunk,
		Choices: []trpcmodel.Choice{{Delta: trpcmodel.Message{ReasoningContent: "想一想"}}},
	}}
	tc := &event.Event{Response: &trpcmodel.Response{
		Object:  trpcmodel.ObjectTypeChatCompletionChunk,
		Choices: []trpcmodel.Choice{{Delta: trpcmodel.Message{Content: "答案"}}},
	}}
	var seq []string
	for _, e := range []*event.Event{rc, tc} {
		seq = append(seq, typesOf(m.MapEvent(destructureTrpc(e)))...)
	}
	seq = append(seq, typesOf(m.Finished())...)
	eq(t, seq, []string{
		"REASONING_START", "REASONING_MESSAGE_START", "REASONING_MESSAGE_CONTENT",
		"REASONING_MESSAGE_END", "REASONING_END",
		"TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT",
		"TEXT_MESSAGE_END", "RUN_FINISHED",
	})
}

// 文字 → 工具 → 文字：工具前关轮，新文字新 messageId
func TestAGUITextToolTextSequence(t *testing.T) {
	m := newAGUIMapper("run3", "s3")
	text1 := &event.Event{Response: &trpcmodel.Response{
		Object: trpcmodel.ObjectTypeChatCompletionChunk,
		Choices: []trpcmodel.Choice{
			{Delta: trpcmodel.Message{Content: "我先查一下"}},
		},
	}}
	toolCall := &event.Event{Response: &trpcmodel.Response{
		Object:  trpcmodel.ObjectTypeChatCompletion,
		Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{ToolCalls: []trpcmodel.ToolCall{{
			ID: "call_a", Function: trpcmodel.FunctionDefinitionParam{Name: "search_notes", Arguments: json.RawMessage(`{"q":"x"}`)},
		}}}}},
	}}
	toolResult := &event.Event{Response: &trpcmodel.Response{
		Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{ToolID: "call_a", ToolName: "search_notes", Content: "3 结果"}}},
	}}
	text2 := &event.Event{Response: &trpcmodel.Response{
		Object: trpcmodel.ObjectTypeChatCompletionChunk,
		Choices: []trpcmodel.Choice{
			{Delta: trpcmodel.Message{Content: "共 3 篇"}},
		},
	}}
	var seq []string
	for _, e := range []*event.Event{text1, toolCall, toolResult, text2} {
		seq = append(seq, typesOf(m.MapEvent(destructureTrpc(e)))...)
	}
	seq = append(seq, typesOf(m.Finished())...)
	eq(t, seq, []string{
		"TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT",
		"TEXT_MESSAGE_END",
		"TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END",
		"TOOL_CALL_RESULT",
		"TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT",
		"TEXT_MESSAGE_END", "RUN_FINISHED",
	})
}

// 同名工具两次调用：各自独立 toolCallId，结果按 id 精确回填
func TestAGUISameToolTwiceDistinctIDs(t *testing.T) {
	m := newAGUIMapper("run4", "s4")
	tc := func(id string) *event.Event {
		return &event.Event{Response: &trpcmodel.Response{
			Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{ToolCalls: []trpcmodel.ToolCall{{
				ID: id, Function: trpcmodel.FunctionDefinitionParam{Name: "echo", Arguments: json.RawMessage(`{}`)},
			}}}}},
		}}
	}
	tr := func(id, content string) *event.Event {
		return &event.Event{Response: &trpcmodel.Response{
			Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{ToolID: id, ToolName: "echo", Content: content}}},
		}}
	}
	var ids []string
	for _, e := range []*event.Event{tc("id1"), tc("id2"), tr("id1", "一"), tr("id2", "二")} {
		for _, ae := range m.MapEvent(destructureTrpc(e)) {
			if ae.Type() == "TOOL_CALL_START" || ae.Type() == "TOOL_CALL_RESULT" {
				b, _ := ae.ToJSON()
				var m2 map[string]any
				_ = json.Unmarshal(b, &m2)
				if k, ok := m2["toolCallId"].(string); ok {
					ids = append(ids, string(ae.Type())+":"+k)
				}
			}
		}
	}
	eq(t, ids, []string{
		"TOOL_CALL_START:id1", "TOOL_CALL_START:id2",
		"TOOL_CALL_RESULT:id1", "TOOL_CALL_RESULT:id2",
	})
}

// 空 toolCallId：服务端兜底生成，两次生成不同
func TestAGUIEmptyToolCallIDGenerated(t *testing.T) {
	m := newAGUIMapper("run5", "s5")
	tc := &event.Event{Response: &trpcmodel.Response{
		Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{ToolCalls: []trpcmodel.ToolCall{{
			ID: "", Function: trpcmodel.FunctionDefinitionParam{Name: "echo", Arguments: json.RawMessage(`{}`)},
		}}}}},
	}}
	var got []string
	for _, ae := range m.MapEvent(destructureTrpc(tc)) {
		if ae.Type() == "TOOL_CALL_START" {
			b, _ := ae.ToJSON()
			var m2 map[string]any
			_ = json.Unmarshal(b, &m2)
			got = append(got, m2["toolCallId"].(string))
		}
	}
	if len(got) != 1 || got[0] == "" {
		t.Fatalf("expected generated id, got %v", got)
	}
}

// ConfirmBroker：per-run emitter，两个 run 互不串扰
func TestConfirmBrokerPerRunEmitters(t *testing.T) {
	b := NewConfirmBroker()
	var gotA, gotB []string
	b.SetEmitter("runA", func(name string, data any) { gotA = append(gotA, name) })
	b.SetEmitter("runB", func(name string, data any) { gotB = append(gotB, name) })

	done := make(chan bool, 2)
	go func() {
		ok, _ := b.Request(context.Background(), "runA", "del", "{}")
		done <- ok
	}()
	go func() {
		ok, _ := b.Request(context.Background(), "runB", "del", "{}")
		done <- ok
	}()
	// 等 A/B 都挂起
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if len(b.PendingIDs()) == 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	b.Resolve("runA", true)
	b.Resolve("runB", false)
	// done 通道的到达序不保证与 run 对应，收集后断言集合
	var results []bool
	results = append(results, <-done, <-done)
	if !(results[0] || results[1]) || (results[0] && results[1]) {
		t.Fatalf("resolve results should be one true one false, got %v", results)
	}
	if len(gotA) == 0 || len(gotB) == 0 {
		t.Fatalf("emitters not called per run: A=%v B=%v", gotA, gotB)
	}
	// 帧名：confirm 请求 + 结果
	if gotA[0] != "tool_confirm" {
		t.Fatalf("first frame should be tool_confirm, got %v", gotA)
	}
}
