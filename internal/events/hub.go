package events

import (
	"sync"
)

// Event 服务端事件总线。订阅者通过 Subscribe 拿一个 channel；Publish 广播
// 事件给所有当前订阅者；Subscribe 返回的 channel 是 buffered 的，慢消费者会
// 被跳过（不让发布方阻塞）。被 SSE handler 使用，向 Web 端实时推送 vault
// 授权状态变化。
type Event struct {
	Type     string `json:"type"`
	VaultID  int64  `json:"vaultId,omitempty"`
	DeviceID string `json:"deviceId,omitempty"`
	// 同步进度（vault.progress 事件用）
	Total int `json:"total,omitempty"`
	Done  int `json:"done,omitempty"`
}

const subBuffer = 16

// Hub 简单广播总线：注册订阅、广播事件
type Hub struct {
	mu     sync.RWMutex
	subs   map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[chan Event]struct{})}
}

// Subscribe 注册一个订阅者，返回的 channel 在 Unsubscribe 前一直有效
func (h *Hub) Subscribe() chan Event {
	ch := make(chan Event, subBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

// Unsubscribe 取消订阅。重复调用安全。
func (h *Hub) Unsubscribe(ch chan Event) {
	h.mu.Lock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
	h.mu.Unlock()
}

// Publish 非阻塞广播：满载订阅者直接跳过（不阻塞 WS handler 主流程）
func (h *Hub) Publish(e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
			// 慢消费者：跳过这条，下次重要状态变化还会再发
		}
	}
}
