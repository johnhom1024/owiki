// owiki 消息协议定义
//
// 传输层: WebSocket (gorilla/websocket)
// 序列化: JSON 帧，每条消息必须有 type 字段做分发
//
// 流程:
//   客户端                          服务端
//   ─────                          ─────
//   hello ──────────────────────►  welcome
//   hashlist ────────────────────►  hashlist_response (差异清单)
//   upload ─────────────────────►  ok (并广播 changed 给其他连接)
//   rename ─────────────────────►  ok (并广播 renamed)
//   delete ─────────────────────►  ok (并广播 deleted)
//   fetch ───────────────────────►  fetch_response (单个文件内容)
//   (其他连接变更时) ◄────────────  changed / renamed / deleted
//   ◄───────────────────────────  ping (服务端 30s 心跳)
//   pong ───────────────────────►  (或用协议层 pong 自动回)

package proto

import "time"

// ---------- 客户端 → 服务端 ----------

// Hello 连接后的第一条消息：认证 + 客户端信息
type Hello struct {
	Type   string `json:"type"`             // 固定 "hello"
	Token  string `json:"token"`            // vault 同步令牌
	// 设备标识：插件首载生成的 UUID，用于设备级授权管理
	DeviceID   string `json:"deviceId,omitempty"`
	DeviceName string `json:"deviceName,omitempty"`
	// 客户端版本（来自插件 manifest.json），用于兼容性与日志诊断。
	// 老客户端不会带此字段，反序列化后为空串，向后兼容。
	ClientVersion string `json:"clientVersion,omitempty"`
}

// HashListEntry 清单对账的一条记录
type HashListEntry struct {
	Path string `json:"path"` // 笔记相对路径，如 "日记/2026-08.md"
	Hash string `json:"hash"` // 内容 SHA-256
	Mtime int64 `json:"mtime"` // 客户端文件修改时间(Unix 秒)
}

// HashList 客户端上报本地清单，请求对账
type HashList struct {
	Type    string          `json:"type"` // 固定 "hashlist"
	Entries []HashListEntry `json:"entries"`
}

// Upload 上传一个变更文件
type Upload struct {
	Type     string `json:"type"` // 固定 "upload"
	Path     string `json:"path"`
	Hash     string `json:"hash"`
	Content  string `json:"content"`
	Mtime    int64  `json:"mtime"`
	BaseHash string `json:"baseHash,omitempty"` // 乐观锁：基于哪一版改的；空=兼容旧客户端，走 LWW
	Force    bool   `json:"force,omitempty"`    // 冲突后用户确认覆盖
}

// Fetch 拉取单个文件内容（收到 changed 广播后，或对账发现需要下载时）
type Fetch struct {
	Type string `json:"type"` // 固定 "fetch"
	Path string `json:"path"`
}

// Rename 把一篇笔记从 From 改到 To（身份仍是路径，这是显式改名）
type Rename struct {
	Type string `json:"type"` // 固定 "rename"
	From string `json:"from"`
	To   string `json:"to"`
}

// Delete 删除一篇笔记
type Delete struct {
	Type string `json:"type"` // 固定 "delete"
	Path string `json:"path"`
}

// Bye 客户端主动断开（插件端「断开并取消授权」）：服务端解除该设备绑定。
// 解绑即删除设备记录，同一设备携有效 token 重连会重新登记。
type Bye struct {
	Type     string `json:"type"` // 固定 "bye"
	DeviceID string `json:"deviceId,omitempty"`
}

// Pong 心跳应答
type Pong struct {
	Type string `json:"type"` // 固定 "pong"
}

// ---------- 服务端 → 客户端 ----------

// Welcome hello 的应答：认证结果
type Welcome struct {
	Type     string    `json:"type"`             // 固定 "welcome"
	OK       bool      `json:"ok"`
	Message  string    `json:"message,omitempty"` // 失败原因
	Vault    string    `json:"vault,omitempty"`   // 认证成功的 vault 名称（客户端展示用）
	ServerAt time.Time `json:"serverAt"`
	// owiki 服务端版本（编译时通过 -ldflags 注入 ws.ServerVersion），
	// 客户端设置页展示，排查兼容性问题时一眼看清两端版本。
	// 老客户端不会读此字段，向后兼容。
	ServerVersion string `json:"serverVersion,omitempty"`
	// SyncEnabled 本连接是否具备文件同步资格。
	// vault 开启单设备同步且本设备不是 pin 设备时为 false：连接保持（授权/心跳/解绑正常），
	// 但一切文件同步消息（hashlist/upload/fetch/rename/delete）会被服务端拒绝，也收不到变更广播。
	// 老服务端不携带此字段，客户端按 true 处理（老服务端没有单设备拦截）。
	SyncEnabled *bool `json:"syncEnabled,omitempty"`
}

// SyncState 服务端主动推送：单设备同步开关或 pin 设备发生变化，
// 本连接的同步资格随之改变（在线切换，无需断线重连）。
// 客户端收到 enabled=true 时应补一次全量对账（静默期间没有广播可收）。
type SyncState struct {
	Type        string `json:"type"` // 固定 "sync_state"
	SyncEnabled bool   `json:"syncEnabled"`
	// 变化原因说明（客户端 Notice/日志展示）
	Message string `json:"message,omitempty"`
}

// 需要客户端处理的差异项
type DiffAction string

const (
	DiffUpload   DiffAction = "upload"   // 服务端没有/更旧 → 客户端上传
	DiffDownload DiffAction = "download" // 服务端更新 → 客户端下载
)

// HashListDiff 对账结果里的单条差异
type HashListDiff struct {
	Path   string     `json:"path"`
	Action DiffAction `json:"action"`
}

// HashListResponse hashlist 的应答：差异清单（只含有差异的）
type HashListResponse struct {
	Type   string         `json:"type"` // 固定 "hashlist_response"
	Diffs  []HashListDiff `json:"diffs"`
}

// OK 通用成功应答（upload/fetch 等的 ack）
type OK struct {
	Type   string `json:"type"` // 固定 "ok"
	For    string `json:"for"`  // 对应的请求 type
	Path   string `json:"path,omitempty"`
	From   string `json:"from,omitempty"`
	To     string `json:"to,omitempty"`
	Hash   string `json:"hash,omitempty"`   // 最终入库哈希（自动合并后可能与上传不同）
	Merged bool   `json:"merged,omitempty"`
}

// Err 通用错误应答
type Err struct {
	Type    string `json:"type"` // 固定 "error"
	Message string `json:"message"`
}

// Changed 广播：某文件被更新（发给除来源外的所有连接）
type Changed struct {
	Type string `json:"type"` // 固定 "changed"
	Path string `json:"path"`
	Hash string `json:"hash"`
}

// Renamed 广播：一篇笔记被改名
type Renamed struct {
	Type string `json:"type"` // 固定 "renamed"
	From string `json:"from"`
	To   string `json:"to"`
}

// Deleted 广播：一篇笔记被删除
type Deleted struct {
	Type string `json:"type"` // 固定 "deleted"
	Path string `json:"path"`
}

// FetchResponse fetch 的应答：文件内容
type FetchResponse struct {
	Type    string `json:"type"` // 固定 "fetch_response"
	Path    string `json:"path"`
	Hash    string `json:"hash"`
	Content string `json:"content"`
	Mtime   int64  `json:"mtime"`
}

// Ping 服务端心跳
type Ping struct {
	Type string `json:"type"` // 固定 "ping"
}

// Conflict 乐观锁失败且无法自动三方合并
type Conflict struct {
	Type          string `json:"type"` // 固定 "conflict"
	Path          string `json:"path"`
	ServerHash    string `json:"serverHash"`
	ServerContent string `json:"serverContent"`
	ServerMtime   int64  `json:"serverMtime"`
	MergedHint    string `json:"mergedHint,omitempty"` // 带冲突标记的提示文本，客户端可展示
}
