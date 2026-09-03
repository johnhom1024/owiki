// Package tools 提供 OWiki 的中立工具层：一套 schema + handler 注册表，
// 供多个「AI 消费方」复用——MCP server（internal/mcp）与未来的内置
// AI 对话 agent loop（internal/agent）。
//
// 设计原则：
//   - 业务逻辑（repo/service 直调、乐观锁、sync_log 留痕、WS 广播）
//     只在这一层实现一次；协议外壳（MCP / OpenAI tools）各自适配
//   - 认证显式化：Session 携带 ApiKey 与操作者名，不从协议请求里挖
//   - 依赖方向：本包不 import 任何 MCP/agent 框架类型；schema 用
//     google/jsonschema-go（go-sdk 同款）从 In/Out 结构体反射生成，
//     保证 MCP 适配层输出与重构前逐字节一致
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"owiki/internal/model"

	"github.com/google/jsonschema-go/jsonschema"
)

// Session 一次工具调用的执行上下文：谁在调、用什么权限。
// MCP 侧从请求头解析构造；agent 侧从服务端配置构造。
type Session struct {
	// Key 本次调用使用的 API key（含 ReadOnly、VaultScope）。
	Key *model.ApiKey
	// Actor sync_log 留痕与广播中的操作者展示名。
	Actor string
	// Source sync_log 来源字段（"mcp" / "chat" 等）。
	Source string
}

// Flag 工具行为注解（MCP annotations 与 agent 侧确认策略的中立来源）。
type Flag int

const (
	// FlagReadOnly 工具只读，不改动任何数据。
	FlagReadOnly Flag = 1 << iota
	// FlagDestructive 工具有破坏性（删除等），agent 侧应先取得用户确认。
	FlagDestructive
	// FlagIdempotent 重复调用结果一致（MCP annotations 同名 hint）。
	FlagIdempotent
)

// Handler 工具实现：入参已按 InputSchema 校验并解出，出参将被
// OutputSchema 校验（协议适配层负责映射成各自的内容块）。
type Handler func(ctx context.Context, s *Session, in json.RawMessage) (any, error)

// Tool 注册表中的一个工具。
type Tool struct {
	// Name 唯一标识（MCP 工具名 / OpenAI function 名同源）。
	Name string
	// Description 面向模型的工具说明（同一份文案喂所有协议）。
	Description string
	// Flags 行为注解。
	Flags Flag
	// Input 输入结构体（jsonschema tag 描述各字段）。
	Input any
	// Output 输出结构体；nil 表示输出不声明 schema（如二进制附件）。
	Output any
	// Handler 实现。
	Handler Handler

	// 反射生成的 schema（NewRegistry 时填充，只读）。
	inputSchema  *jsonschema.Schema
	outputSchema *jsonschema.Schema
}

// ReadOnly reports whether the tool only reads data.
func (t *Tool) ReadOnly() bool { return t.Flags&FlagReadOnly != 0 }

// Destructive reports whether the tool can destroy data.
func (t *Tool) Destructive() bool { return t.Flags&FlagDestructive != 0 }

// InputSchema 返回反射生成的输入 schema。
func (t *Tool) InputSchema() *jsonschema.Schema { return t.inputSchema }

// OutputSchema 返回反射生成的输出 schema；无则为 nil。
func (t *Tool) OutputSchema() *jsonschema.Schema { return t.outputSchema }

// Registry 工具注册表。
type Registry struct {
	tools  []*Tool
	byName map[string]*Tool
}

// NewRegistry 建注册表并反射生成 schema。
// input/output 为每个工具的 In/Out 结构体；nil 表示不声明 schema。
func NewRegistry(ts ...Tool) (*Registry, error) {
	r := &Registry{byName: make(map[string]*Tool, len(ts))}
	for i := range ts {
		t := &ts[i]
		if t.Name == "" {
			return nil, fmt.Errorf("tool %d: name required", i)
		}
		if t.Handler == nil {
			return nil, fmt.Errorf("tool %q: handler required", t.Name)
		}
		if t.Input != nil {
			s, err := schemaFor(t.Input)
			if err != nil {
				return nil, fmt.Errorf("tool %q: input schema: %w", t.Name, err)
			}
			t.inputSchema = s
		}
		if t.Output != nil {
			s, err := schemaFor(t.Output)
			if err != nil {
				return nil, fmt.Errorf("tool %q: output schema: %w", t.Name, err)
			}
			t.outputSchema = s
		}
		if _, dup := r.byName[t.Name]; dup {
			return nil, fmt.Errorf("duplicate tool name %q", t.Name)
		}
		r.tools = append(r.tools, t)
		r.byName[t.Name] = t
	}
	return r, nil
}

// All 全部工具（注册顺序）。
func (r *Registry) All() []*Tool { return r.tools }

// ReadOnly 只读工具集（readOnly key / agent 只读模式用）。
func (r *Registry) ReadOnly() []*Tool {
	out := make([]*Tool, 0, len(r.tools))
	for _, t := range r.tools {
		if t.ReadOnly() {
			out = append(out, t)
		}
	}
	return out
}

// Find 按名取工具。
func (r *Registry) Find(name string) (*Tool, bool) {
	t, ok := r.byName[name]
	return t, ok
}

func schemaFor(v any) (*jsonschema.Schema, error) {
	rt := reflect.TypeOf(v)
	if rt.Kind() == reflect.Pointer {
		rt = rt.Elem()
	}
	return jsonschema.ForType(rt, &jsonschema.ForOptions{})
}
