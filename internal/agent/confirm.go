package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
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
// 工具执行侧（goroutine A）阻塞等信号；用户在 SSE 流上看到 confirm
// 事件后经 HTTP 端点回调 Resolve（goroutine B）。同一时间每个对话流
// 最多挂起一个待确认请求；超时（默认 120s）视为拒绝。
type ConfirmBroker struct {
	mu       sync.Mutex
	pending  map[string]chan bool // runID -> resolve 通道
	requests map[string]*ConfirmRequest
	// emit SSE 推帧回调（api.go 流式端点注入；nil 时无确认流）。
	// 在锁外调用，避免死锁。
	emit func(name string, data any)
}

func NewConfirmBroker() *ConfirmBroker {
	return &ConfirmBroker{
		pending:  make(map[string]chan bool),
		requests: make(map[string]*ConfirmRequest),
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

	b.mu.Lock()
	if b.emit != nil {
		b.emit("confirm", gin.H{
			"runId": runID, "confirmId": id, "tool": toolName, "args": args,
		})
	}
	if _, dup := b.pending[runID]; dup {
		b.mu.Unlock()
		// 同一流已有挂起请求：不允许并发危险操作，直接拒绝本次。
		return false, nil
	}
	b.pending[runID] = ch
	b.requests[runID] = req
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.pending, runID)
		delete(b.requests, runID)
		b.mu.Unlock()
	}()

	timeout := time.NewTimer(ConfirmTimeout)
	defer timeout.Stop()
	select {
	case ok := <-ch:
		return ok, nil
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timeout.C:
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
	ch <- approved
	return true
}

// SetEmitter 注入 SSE 推帧回调（每个流式端点开始时设置）。
func (b *ConfirmBroker) SetEmitter(fn func(name string, data any)) {
	b.mu.Lock()
	b.emit = fn
	b.mu.Unlock()
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
