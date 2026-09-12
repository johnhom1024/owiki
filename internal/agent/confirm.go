package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// ConfirmRequest 一次待确认的危险操作。
type ConfirmRequest struct {
	ID        string `json:"id"`
	Tool      string `json:"tool"`
	Args      string `json:"args"`
	CreatedAt int64  `json:"createdAt"`
}

// ConfirmBroker 危险工具的人工确认中介。
//
// 工具执行侧（goroutine A）阻塞等信号；用户在 SSE 流上看到 CUSTOM(tool_confirm)
// 事件后经 HTTP 端点回调 Resolve（goroutine B）。同一时间每个对话流最多挂起一个
// 待确认请求；超时（默认 120s）视为拒绝。
//
// emitter 按 runID 注册（每个流一个）：多标签页同时对话时确认帧各回各的流，
// 互不串扰。回调在锁外调用——emit 会写 HTTP response，持锁写会卡住所有确认流。
type ConfirmBroker struct {
	mu       sync.Mutex
	pending  map[string]chan bool // runID -> resolve 通道
	requests map[string]*ConfirmRequest
	emitters map[string]func(name string, data any) // runID -> SSE 推帧回调
}

func NewConfirmBroker() *ConfirmBroker {
	return &ConfirmBroker{
		pending:  make(map[string]chan bool),
		requests: make(map[string]*ConfirmRequest),
		emitters: make(map[string]func(name string, data any)),
	}
}

// SetEmitter 注册/注销（fn=nil）某个 run 的 SSE 推帧回调。
// 流式端点开始时注册，结束（含断开）时注销。
func (b *ConfirmBroker) SetEmitter(runID string, fn func(name string, data any)) {
	b.mu.Lock()
	if fn == nil {
		delete(b.emitters, runID)
	} else {
		b.emitters[runID] = fn
	}
	b.mu.Unlock()
}

// emitTo 锁外调用 runID 的 emitter（不存在则 no-op）。
func (b *ConfirmBroker) emitTo(runID, name string, data any) {
	b.mu.Lock()
	fn := b.emitters[runID]
	b.mu.Unlock()
	if fn != nil {
		fn(name, data)
	}
}

// Request 阻塞等待用户对一次危险操作的裁决。
// ctx 取消（用户断开 SSE / 服务端停机）同样视为拒绝。
func (b *ConfirmBroker) Request(ctx context.Context, runID, toolName, args string) (bool, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return false, err
	}
	id := hex.EncodeToString(buf)
	ch := make(chan bool, 1)
	req := &ConfirmRequest{ID: id, Tool: toolName, Args: args, CreatedAt: time.Now().Unix()}

	if dup := func() bool {
		b.mu.Lock()
		defer b.mu.Unlock()
		if _, dup := b.pending[runID]; dup {
			return true // 同一流已有挂起请求：不允许并发危险操作
		}
		b.pending[runID] = ch
		b.requests[runID] = req
		return false
	}(); dup {
		return false, nil
	}
	defer func() {
		b.mu.Lock()
		delete(b.pending, runID)
		delete(b.requests, runID)
		b.mu.Unlock()
	}()
	// 锁外推帧：emit 内部写 HTTP response
	b.emitTo(runID, "tool_confirm", map[string]any{
		"runId": runID, "confirmId": id, "tool": toolName, "args": args,
	})

	timeout := time.NewTimer(ConfirmTimeout)
	defer timeout.Stop()
	select {
	case ok := <-ch:
		return ok, nil
	case <-ctx.Done():
		b.emitTo(runID, "tool_confirm_result", map[string]any{
			"runId": runID, "confirmId": id, "approved": false, "reason": "canceled",
		})
		return false, ctx.Err()
	case <-timeout.C:
		b.emitTo(runID, "tool_confirm_result", map[string]any{
			"runId": runID, "confirmId": id, "approved": false, "reason": "timeout",
		})
		return false, nil
	}
}

// Resolve 用户点了确认/取消（HTTP 端点调用）。
func (b *ConfirmBroker) Resolve(runID string, approved bool) bool {
	b.mu.Lock()
	ch, ok := b.pending[runID]
	if ok {
		delete(b.pending, runID)
		delete(b.requests, runID)
	}
	b.mu.Unlock()
	if !ok {
		return false
	}
	b.emitTo(runID, "tool_confirm_result", map[string]any{
		"runId": runID, "approved": approved,
	})
	ch <- approved
	return true
}

// Pending 当前挂起的确认请求（SSE 重连/前端刷新后补发）。
func (b *ConfirmBroker) Pending(runID string) *ConfirmRequest {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.requests[runID]
}

// PendingIDs 全部挂起中的 runID（测试与排障用）。
func (b *ConfirmBroker) PendingIDs() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]string, 0, len(b.pending))
	for id := range b.pending {
		out = append(out, id)
	}
	return out
}

// ConfirmTimeout 挂起确认的存活时间（var 便于测试覆盖）。
var ConfirmTimeout = 120 * time.Second
