package agent

import (
	"context"
	"fmt"
	"log"
	"sync"

	"owiki/internal/model"
	"owiki/internal/repository"
	"owiki/internal/tools"

	"trpc.group/trpc-go/trpc-agent-go/agent/llmagent"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
	"trpc.group/trpc-go/trpc-agent-go/model/openai"
	"trpc.group/trpc-go/trpc-agent-go/runner"
)

// AppName trpc 会话命名空间。
const AppName = "owiki"

// UserID 内置对话只有管理员一个用户。
const UserID = "admin"

// SystemPrompt 内置助手的人设与工作说明。
const SystemPrompt = `你是 OWiki 笔记库的内置 AI 助手。OWiki 是一个自托管的 Obsidian 同步与 Wiki 服务。

你的能力：
- 通过工具读写、搜索、整理用户的所有笔记（vault）
- 查询笔记间的链接关系（outlinks/backlinks/orphans）
- 管理分享、查看库统计等

工作准则：
- 用户语言问你，你就用什么语言答
- 改动笔记前先读一遍（read_note 拿 contentHash），写入时带上 baseHash 防冲突
- 删除等破坏性操作会请求用户确认，这是预期流程
- 回答尽量简洁，引用笔记时给出路径
- 不要一次批量改动大量笔记，先说明计划再做`

// Manager 持有 runner 生命周期：配置变化 → 惰性重建。
// Run 走 SSE handler（见 api.go），这里只管构造与缓存。
type Manager struct {
	settings *repository.AISettingsRepo
	host     *tools.Host
	store    *repository.ChatStore
	broker   *ConfirmBroker

	mu     sync.Mutex
	runner runner.Runner
	built  *model.AISettings // 构建时的配置快照（比对用）
}

func NewManager(settings *repository.AISettingsRepo, host *tools.Host, store *repository.ChatStore) *Manager {
	return &Manager{
		settings: settings,
		host:     host,
		store:    store,
		broker:   NewConfirmBroker(),
	}
}

// Broker 暴露确认中介（HTTP 端点 Resolve 用）。
func (m *Manager) Broker() *ConfirmBroker { return m.broker }

// Runner 取当前 runner；配置变化或未建则重建（惰性 + 缓存）。
// 未配置/未就绪返回错误（调用方 503）。
func (m *Manager) Runner(ctx context.Context) (runner.Runner, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, err := m.settings.Load(ctx)
	if err != nil {
		return nil, fmt.Errorf("ai not configured")
	}
	if !a.Ready() {
		return nil, fmt.Errorf("ai not ready")
	}
	if m.runner != nil && m.built != nil && sameConfig(m.built, a) {
		return m.runner, nil
	}
	if m.runner != nil {
		if c, ok := m.runner.(interface{ Close() error }); ok {
			_ = c.Close()
		}
	}
	mdl := openai.New(a.Model,
		openai.WithBaseURL(a.BaseURL),
		openai.WithAPIKey(a.APIKey),
	)
	ag := llmagent.New("owiki-assistant",
		llmagent.WithModel(mdl),
		llmagent.WithTools(BridgeTools(m.host.Registry(), m.broker)),
		llmagent.WithInstruction(SystemPrompt),
		llmagent.WithGenerationConfig(trpcmodel.GenerationConfig{Stream: true}),
		// 防失控：单轮对话最多 25 次模型往返 / 40 次工具迭代
		llmagent.WithMaxLLMCalls(25),
		llmagent.WithMaxToolIterations(40),
	)
	r := runner.NewRunner(AppName, ag,
		runner.WithSessionService(NewSessionService(m.store)),
	)
	m.runner = r
	m.built = a
	log.Printf("agent: runner (re)built for model %s", a.Model)
	return r, nil
}

// Invalidate 配置变更后调用：丢弃缓存 runner（下次对话重建）。
func (m *Manager) Invalidate() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runner != nil {
		if c, ok := m.runner.(interface{ Close() error }); ok {
			_ = c.Close()
		}
	}
	m.runner = nil
	m.built = nil
}

// sameConfig 判断配置变化是否影响 runner 构造。
// 只比较影响模型调用的四项；测试状态（LastTest*）不影响 runner 本体。
func sameConfig(a, b *model.AISettings) bool {
	return a.Enabled == b.Enabled && a.BaseURL == b.BaseURL &&
		a.APIKey == b.APIKey && a.Model == b.Model
}
