// Package agent 内置 AI 对话的桥接层：把 internal/tools 中立注册表的
// 21 个工具适配给 trpc-agent-go 的 agent loop，并实现危险工具的
// 人工确认流（SSE confirm 事件 + HTTP 确认端点信号）。
//
// 分层：
//   - 协议/循环：trpc-agent-go（llmagent + runner + model/openai）
//   - 工具与业务：internal/tools（与 MCP 完全同一套实现）
//   - 本包只做「胶水」：工具桥、Session 身份、确认流、SSE 事件映射
package agent

import (
	"context"
	"encoding/json"

	"owiki/internal/model"
	"owiki/internal/repository"
	"owiki/internal/tools"

	"trpc.group/trpc-go/trpc-agent-go/tool"
)

// ActorName sync_log 里的操作者展示名。
const ActorName = "AI 对话"

// internalKey 内置 agent 的合成身份：VaultScope=0（全库）、ReadOnly=false。
// tools 层所有校验只读这两个字段，MCP 路径的 Verify() 不会走到，
// 因此无需持久化——进程内构造即可。
func internalKey() *model.ApiKey {
	return &model.ApiKey{VaultScope: 0, ReadOnly: false}
}

// runIDKey 上下文键：当前对话流的 runID（SSE 端点注入，确认流用）。
type runIDKey struct{}

// WithRunID 把 runID 塞进 ctx（SSE handler 里调）。
func WithRunID(ctx context.Context, runID string) context.Context {
	return context.WithValue(ctx, runIDKey{}, runID)
}

// runIDFrom 从 ctx 取 runID；没有则空串。
func runIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(runIDKey{}).(string); ok {
		return v
	}
	return ""
}

// bridgedTool 把一个 tools.Tool 包成 trpc 的 CallableTool。
type bridgedTool struct {
	t  *tools.Tool
	cb *ConfirmBroker // 可为 nil（无确认流，直接执行）
}

// schemaToTrpc 把 google/jsonschema-go 的 schema 转成 trpc tool.Schema。
// 字段名同构，走 JSON 往返最省事且不会漏新增字段。
// 联合类型归一化：google 库对可空字段生成 type 数组（如 ["string","null"]），
// trpc Schema.Type 是纯 string——取第一个非 "null" 元素（信息量最大的主类型）。
func schemaToTrpc(s interface {
	MarshalJSON() ([]byte, error)
}) (*tool.Schema, error) {
	if s == nil {
		return nil, nil
	}
	b, err := s.MarshalJSON()
	if err != nil {
		return nil, err
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	normalizeSchemaTypes(raw)
	nb, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var out tool.Schema
	if err := json.Unmarshal(nb, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// normalizeSchemaTypes 递归把 type 数组折叠成单值。
func normalizeSchemaTypes(m map[string]any) {
	if arr, ok := m["type"].([]any); ok && len(arr) > 0 {
		pick := ""
		for _, v := range arr {
			if s, ok := v.(string); ok && s != "null" {
				pick = s
				break
			}
		}
		if pick == "" {
			delete(m, "type")
		} else {
			m["type"] = pick
		}
	}
	for _, v := range m {
		switch x := v.(type) {
		case map[string]any:
			normalizeSchemaTypes(x)
		case []any:
			for _, item := range x {
				if sub, ok := item.(map[string]any); ok {
					normalizeSchemaTypes(sub)
				}
			}
		}
	}
}

// Declaration 实现 tool.Tool：同一份 Name/Description/Schema 喂 agent。
func (b *bridgedTool) Declaration() *tool.Declaration {
	in, err := schemaToTrpc(b.t.InputSchema())
	if err != nil {
		panic("agent bridge: input schema: " + err.Error()) // 程序员错误，启动即炸
	}
	var out *tool.Schema
	if b.t.OutputSchema() != nil {
		out, err = schemaToTrpc(b.t.OutputSchema())
		if err != nil {
			panic("agent bridge: output schema: " + err.Error())
		}
	}
	return &tool.Declaration{
		Name:         b.t.Name,
		Description:  b.t.Description,
		InputSchema:  in,
		OutputSchema: out,
	}
}

// Call 实现 tool.CallableTool：构造内部管理员 Session 执行。
func (b *bridgedTool) Call(ctx context.Context, jsonArgs []byte) (any, error) {
	sess := &tools.Session{Key: internalKey(), Actor: ActorName, Source: repository.SourceChat}
	if b.t.Destructive() && b.cb != nil {
		if runID := runIDFrom(ctx); runID != "" {
			approved, err := b.cb.Request(ctx, runID, b.t.Name, string(jsonArgs))
			if err != nil {
				return nil, err
			}
			if !approved {
				return map[string]any{
					"error":  "user denied this destructive operation",
					"denied": true,
					"tool":   b.t.Name,
					"args":   json.RawMessage(jsonArgs),
				}, nil
			}
		}
	}
	return b.t.Handler(ctx, sess, json.RawMessage(jsonArgs))
}

// BridgeTools 把注册表全部工具桥接成 trpc 工具列表。
func BridgeTools(reg *tools.Registry, cb *ConfirmBroker) []tool.Tool {
	ts := reg.All()
	out := make([]tool.Tool, 0, len(ts))
	for _, t := range ts {
		out = append(out, &bridgedTool{t: t, cb: cb})
	}
	return out
}

var _ tool.CallableTool = (*bridgedTool)(nil)
