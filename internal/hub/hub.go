// Package hub 管理所有 WebSocket 连接：注册、注销、按 vault 广播。
// gorilla/websocket 只给单连接读写，多连接的协调要自己写——就是这个 Hub。
package hub

import (
	"sync"

	"github.com/gorilla/websocket"
)

// Client 一个已认证的 WebSocket 连接
type Client struct {
	Conn *websocket.Conn
	Send chan []byte // 出站队列：所有写都经它，由 writePump 单 goroutine 消费
	Name string      // 标识（客户端上报，用于日志）
	// VaultID 认证后绑定的 vault；0 表示未认证
	VaultID int64
	// DeviceID / DeviceName 客户端上报的设备标识与名称（bye 解绑、同步日志用）
	DeviceID   string
	DeviceName string
	// SyncEnabled 本连接是否具备文件同步资格（单设备同步模式下仅 pin 设备为 true）。
	// 非同步连接保持在 hub 里：授权、心跳、解绑一切正常，只是：
	//  - 文件同步消息（hashlist/upload/fetch/rename/delete）被服务端拒绝
	//  - 收不到变更广播（完全静默，不接收下行）
	// vault 未开启单设备同步时恒为 true。
	SyncEnabled bool
	// mu 保护 SyncEnabled 的并发读写（hello 写、消息处理读、pin 切换推送写）
	mu sync.RWMutex
}

// SyncEnabledValue 并发安全地读 SyncEnabled
func (c *Client) SyncEnabledValue() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.SyncEnabled
}

// SetSyncEnabled 并发安全地写 SyncEnabled
func (c *Client) SetSyncEnabled(v bool) {
	c.mu.Lock()
	c.SyncEnabled = v
	c.mu.Unlock()
}

// Hub 连接管理器
type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]struct{}
}

func New() *Hub {
	return &Hub{clients: make(map[*Client]struct{})}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	close(c.Send)
}

// BroadcastVault 广播给某个 vault 的具备同步资格的连接（除 exclude 外）。
// 单设备同步模式下非 pin 设备完全静默：不接收任何变更广播。
func (h *Hub) BroadcastVault(vaultID int64, msg []byte, exclude *Client) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c == exclude || c.VaultID != vaultID || !c.SyncEnabledValue() {
			continue
		}
		// 非阻塞投递：队列满的慢客户端直接跳过（它会通过对账补齐）
		select {
		case c.Send <- msg:
		default:
		}
	}
}

// CountByDevice 返回某 vault 上与指定 deviceId 相同的已认证连接数（不含 exclude）。
// 用于服务端识别「同一设备多条并存连接」——典型成因是同一 vault 同时被
// iCloud 与 owiki 两条通道写入、或多开 Obsidian，是回声循环的温床。
func (h *Hub) CountByDevice(vaultID int64, deviceID string, exclude *Client) int {
	if deviceID == "" {
		return 0
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for c := range h.clients {
		if c == exclude || c.VaultID != vaultID || c.DeviceID != deviceID {
			continue
		}
		n++
	}
	return n
}

// BroadcastAll 广播给所有已认证连接（跨 vault，极少用）
func (h *Hub) BroadcastAll(msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.Send <- msg:
		default:
		}
	}
}

// CountVault 某 vault 当前连接数
func (h *Hub) CountVault(vaultID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for c := range h.clients {
		if c.VaultID == vaultID {
			n++
		}
	}
	return n
}

// CloseVault 强制断开某 vault 的全部连接（取消授权用）。
// 关闭 Send 队列会触发各连接 writePump 退出并关Conn。
func (h *Hub) CloseVault(vaultID int64) {
	h.closeVault(vaultID, "")
}

// PushSyncState 单设备同步开关/pin 变化时，给 vault 内每个在线连接
// 推送其新的同步资格并更新 Client.SyncEnabled：被静默的设备原地降级
// （连接保持，授权/心跳/解绑正常），被恢复的设备原地升级（客户端补对账）。
// 老客户端不认识 sync_state 消息会忽略（JSON 消息按 type 分发，未知 type 安全跳过）。
func (h *Hub) PushSyncState(vaultID int64, syncEnabled func(deviceID string) bool, msgFactory func(enabled bool) []byte) {
	h.mu.RLock()
	var targets []*Client
	for c := range h.clients {
		if c.VaultID != vaultID {
			continue
		}
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		enabled := syncEnabled(c.DeviceID)
		c.SetSyncEnabled(enabled)
		if msg := msgFactory(enabled); msg != nil {
			select {
			case c.Send <- msg:
			default:
			}
		}
	}
}

// CloseVaultExcept 强制断开某 vault 上除 keepDeviceID 外的全部连接。
// 仅剩取消授权（revoke）等需要彻底断线的场景使用；单设备同步开关
// 不再踢线（改走 PushSyncState 在线降级/升级）。
func (h *Hub) CloseVaultExcept(vaultID int64, keepDeviceID string) {
	h.closeVault(vaultID, keepDeviceID)
}

func (h *Hub) closeVault(vaultID int64, keepDeviceID string) {
	h.mu.RLock()
	var victims []*Client
	for c := range h.clients {
		if c.VaultID != vaultID {
			continue
		}
		if keepDeviceID != "" && c.DeviceID == keepDeviceID {
			continue
		}
		victims = append(victims, c)
	}
	h.mu.RUnlock()
	for _, c := range victims {
		c.Conn.Close()
	}
}

// Count 当前连接数（全部）
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
