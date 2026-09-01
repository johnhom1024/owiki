// Package ws WebSocket 同步端点：连接生命周期 + 消息分发。
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"owiki/internal/events"
	"owiki/internal/hub"
	"owiki/internal/model"
	"owiki/internal/proto"
	"owiki/internal/repository"
	"owiki/internal/service"

	"github.com/gorilla/websocket"
)

// ServerVersion owiki 服务端版本，通过 -ldflags 在编译时注入，
// 用于在 welcome 消息里告诉客户端「你连的服务端是什么版本」。
// 未注入时为 "dev"（本地开发默认）。
var ServerVersion = "dev"

// WebSocket 同步服务
type Server struct {
	hub        *hub.Hub
	repo       *repository.NoteRepo
	vaultRepo  *repository.VaultRepo
	deviceRepo *repository.DeviceRepo
	eventHub   *events.Hub
	attach     *repository.AttachStore
	syncLog    *repository.SyncLogRepo
	share      *repository.ShareRepo

	progressMu sync.Mutex
	progress   map[int64]*syncProgress
}

// syncProgress 单个 vault 的同步进度（本次对账）
type syncProgress struct {
	total int
	done  int
	paths map[string]struct{} // 待完成路径
}

func NewServer(h *hub.Hub, repo *repository.NoteRepo, vaultRepo *repository.VaultRepo, deviceRepo *repository.DeviceRepo, eventHub *events.Hub, attach *repository.AttachStore, syncLog *repository.SyncLogRepo, share *repository.ShareRepo) *Server {
	return &Server{hub: h, repo: repo, vaultRepo: vaultRepo, deviceRepo: deviceRepo, eventHub: eventHub, attach: attach, syncLog: syncLog, share: share}
}

// logSync 落一条同步日志并推送 vault.log SSE 事件（Web 端日志时间线实时刷新）。
// 日志失败不影响同步主流程。
func (s *Server) logSync(vaultID int64, action, path, detail string, size int64, deviceID, deviceName string) {
	s.syncLog.Record(context.Background(), vaultID, action, path, detail, repository.SourceWs, deviceID, deviceName, size)
	if s.eventHub != nil {
		s.eventHub.Publish(events.Event{
			Type:     "vault.log",
			VaultID:  vaultID,
			DeviceID: deviceID,
		})
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // 插件端_origin 不可控，MVP 放开
}

// Handle WS 握手入口（挂在 Gin 路由 /ws 上）
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade: %v", err)
		return
	}

	client := &hub.Client{Conn: conn, Send: make(chan []byte, 64)}
	s.hub.Register(client)

	// 每个连接两个 goroutine（gorilla 官方推荐模式）：
	// readPump: 收消息 → 业务分发；writePump: 消费 Send 队列 + 心跳
	go s.writePump(client)
	go s.readPump(client)
}

// ---------- 读循环 ----------

func (s *Server) readPump(c *hub.Client) {
	defer func() {
		s.hub.Unregister(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(16 << 20) // 单条消息上限 16MB（超大附件防滥用）
	_ = c.Conn.SetReadDeadline(time.Now().Add(75 * time.Second))

	for {
		_, data, err := c.Conn.ReadMessage()
		if err != nil {
			log.Printf("[ws] read closed: %v", err)
			return
		}
		_ = c.Conn.SetReadDeadline(time.Now().Add(75 * time.Second))

		// 通用信封解析出 type 再分发
		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil {
			s.sendErr(c, "invalid json: "+err.Error())
			continue
		}

		// hello 之外的所有操作都要求先认证（绑定 vault）
		if envelope.Type != "hello" && c.VaultID == 0 {
			s.sendErr(c, "not authed: send hello first")
			continue
		}
		// 单设备同步：非 pin 设备的文件同步消息在此统一拦截。
		// bye（解绑）不拦：静默设备也要能取消授权。
		if !c.SyncEnabledValue() && isFileSyncMsg(envelope.Type) {
			log.Printf("[ws] BLOCKED %s from non-sync device=%s… vault=%d", envelope.Type, shortID(c.DeviceID), c.VaultID)
			s.sendJSON(c, proto.Err{
				Type: "error",
				Message: "单设备同步模式：本设备未被选为同步设备，此变更不会被同步。请在 OWiki Web 管理端更换选定设备，或关闭该模式",
			})
			continue
		}

		switch envelope.Type {
		case "hello":
			s.handleHello(c, data)
		case "hashlist":
			s.handleHashList(c, data)
		case "upload":
			s.handleUpload(c, data)
		case "fetch":
			s.handleFetch(c, data)
		case "rename":
			s.handleRename(c, data)
		case "delete":
			s.handleDelete(c, data)
		case "bye":
			s.handleBye(c, data)
		case "pong":
			// 心跳应答，无需处理
		default:
			s.sendErr(c, "unknown message type: "+envelope.Type)
		}
	}
}

// ---------- 写循环 + 心跳 ----------

func (s *Server) writePump(c *hub.Client) {
	ticker := time.NewTicker(30 * time.Second) // 心跳间隔
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			ping, _ := json.Marshal(proto.Ping{Type: "ping"})
			if err := c.Conn.WriteMessage(websocket.TextMessage, ping); err != nil {
				return
			}
		}
	}
}

// ---------- 业务处理 ----------

// shortID 设备标识缩略（日志用）：取前 8 位即可区分设备
func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

// isFileSyncMsg 是否文件同步类消息（单设备模式下非 pin 设备被拦截的集合）
func isFileSyncMsg(t string) bool {
	switch t {
	case "hashlist", "upload", "fetch", "rename", "delete":
		return true
	}
	return false
}

// handleHello 认证：token 定位 vault，deviceId 做设备登记。
// - 设备首次出现 → 自动登记（授权即绑定设备）
// - token 错误不断连，给客户端重试机会；VaultID 保持 0，一切同步操作被拒。
func (s *Server) handleHello(c *hub.Client, data []byte) {
	var m proto.Hello
	if err := json.Unmarshal(data, &m); err != nil {
		s.sendErr(c, "bad hello: "+err.Error())
		return
	}
	vault, err := s.vaultRepo.GetByToken(context.Background(), m.Token)
	if err != nil {
		if errors.Is(err, repository.ErrVaultNotFound) {
			s.sendJSON(c, proto.Welcome{Type: "welcome", OK: false, Message: "invalid token"})
			return
		}
		s.sendErr(c, "db error: "+err.Error())
		return
	}
	// 单设备同步模式：连接照常放行（授权/登记/心跳/解绑一切正常），
	// 仅文件同步资格受 pin 限制——非 pin 设备的同步消息在 handler 层被拒，
	// 也收不到变更广播。welcome.syncEnabled 把这一资格告知客户端。
	syncEnabled := !vault.SingleDevice || m.DeviceID == vault.PinnedDeviceID
	if vault.SingleDevice && !syncEnabled {
		log.Printf("[ws] hello vault=%q: device=%s… (%s) connected, file sync disabled (single-device mode, pinned=%s…)",
			vault.Name, shortID(m.DeviceID), m.DeviceName, shortID(vault.PinnedDeviceID))
	}
	// 设备登记（旧版客户端没带 deviceId：放行，不登记，保持兼容）
	if m.DeviceID != "" {
		if _, err := s.deviceRepo.Authenticate(context.Background(), vault.ID, m.DeviceID, m.DeviceName, m.ClientVersion); err != nil {
			s.sendErr(c, "device auth: "+err.Error())
			return
		}
	}
	c.VaultID = vault.ID
	c.Name = vault.Name
	c.DeviceID = m.DeviceID
	c.DeviceName = m.DeviceName
	c.SetSyncEnabled(syncEnabled)
	// 同设备多条并存连接告警：正常情况一台机器只应有一条连接。
	// 出现重复通常是 Obsidian 多开、或同一 vault 被 iCloud 与 owiki 双通道
	// 同时写入（回声循环/冲突副本的根源），必须在日志里显眼地暴露出来。
	if n := s.hub.CountByDevice(vault.ID, m.DeviceID, c); n > 0 {
		log.Printf("[ws] WARNING: vault=%q deviceId=%s… has %d other live connection(s) besides this one — duplicate device connections cause echo loops and 'xxx 2.md' conflict copies",
			vault.Name, shortID(m.DeviceID), n)
	}
	// 记录最近一次认证成功时间（Web 端「已授权」状态判定）
	_ = s.vaultRepo.SetLastSeen(context.Background(), vault.ID, time.Now())
	syncEnabledFlag := syncEnabled
	s.sendJSON(c, proto.Welcome{
		Type: "welcome", OK: true, Vault: vault.Name,
		ServerAt: time.Now(), ServerVersion: ServerVersion,
		SyncEnabled: &syncEnabledFlag,
	})
	// 客户端版本是排查兼容性的第一手信息：空串/老客户端时回退 "unknown"，
	// 让日志至少能区分「老客户端」与「传了空串的 bug」。
	clientVer := m.ClientVersion
	if clientVer == "" {
		clientVer = "unknown"
	}
	log.Printf("[ws] hello vault=%q device=%s… name=%q clientVersion=%s syncEnabled=%v from %s",
		vault.Name, shortID(m.DeviceID), m.DeviceName, clientVer, syncEnabled, c.Conn.RemoteAddr())
	s.logSync(vault.ID, repository.ActionDevConnect, "", "clientVersion="+clientVer+" syncEnabled="+strconv.FormatBool(syncEnabled), 0, m.DeviceID, m.DeviceName)
	// 通知 Web 端：vault 状态变化（设备绑定/重连成功）。Web 端订阅 SSE 后
	// 自动重查列表/设置页，让「已授权」状态实时变化
	if s.eventHub != nil {
		s.eventHub.Publish(events.Event{
			Type:     "vault.authorized",
			VaultID:  vault.ID,
			DeviceID: m.DeviceID,
		})
	}
}

// handleHashList 清单对账：比对客户端清单和服务端库（本 vault），返回差异动作
func (s *Server) handleHashList(c *hub.Client, data []byte) {
	var m proto.HashList
	if err := json.Unmarshal(data, &m); err != nil {
		s.sendErr(c, "bad hashlist: "+err.Error())
		return
	}

	ctx := context.Background()
	serverNotes, err := s.repo.ListHashes(ctx, c.VaultID)
	if err != nil {
		s.sendErr(c, "db error: "+err.Error())
		return
	}

	diffs := make([]proto.HashListDiff, 0)
	// ① 客户端有 → 服务端比对
	for _, e := range m.Entries {
		sn, exist := serverNotes[e.Path]
		switch {
		case !exist:
			diffs = append(diffs, proto.HashListDiff{Path: e.Path, Action: proto.DiffUpload})
		case sn.ContentHash != e.Hash:
			// 哈希不同，LWW：比 mtime 决定方向（相等时倾向客户端上传，保证收敛）
			if sn.Mtime >= e.Mtime {
				diffs = append(diffs, proto.HashListDiff{Path: e.Path, Action: proto.DiffDownload})
			} else {
				diffs = append(diffs, proto.HashListDiff{Path: e.Path, Action: proto.DiffUpload})
			}
		}
	}
	// ② 服务端有、客户端清单没有 → 客户端缺文件，下载
	entries := make(map[string]struct{}, len(m.Entries))
	for _, e := range m.Entries {
		entries[e.Path] = struct{}{}
	}
	for path := range serverNotes {
		if _, ok := entries[path]; !ok {
			diffs = append(diffs, proto.HashListDiff{Path: path, Action: proto.DiffDownload})
		}
	}

	s.sendJSON(c, proto.HashListResponse{Type: "hashlist_response", Diffs: diffs})
	// 记录同步进度并推送到 Web 端（无差异则跳过）
	s.setSyncProgress(c.VaultID, diffs)
}

// handleUpload 接收文件 → upsert 入库 → 广播 changed 给同 vault 其他连接
func (s *Server) handleUpload(c *hub.Client, data []byte) {
	var m proto.Upload
	if err := json.Unmarshal(data, &m); err != nil {
		s.sendErr(c, "bad upload: "+err.Error())
		return
	}
	if m.Path == "" {
		s.sendErr(c, "upload: empty path")
		return
	}

	// 附件（图片等二进制）：内容存文件系统，元数据走 notes 表
	if repository.IsAttachment(m.Path) {
		if err := s.handleAttachmentUpload(c, m); err != nil {
			s.sendErr(c, "upload attachment: "+err.Error())
		}
		return
	}

	res, err := service.Save(context.Background(), s.repo, service.SaveInput{
		VaultID:  c.VaultID,
		Path:     m.Path,
		Content:  m.Content,
		Hash:     m.Hash,
		Mtime:    m.Mtime,
		BaseHash: m.BaseHash,
		Force:    m.Force,
	})
	if err != nil {
		var ce *service.ConflictError
		if errors.As(err, &ce) {
			// 冲突留痕：客户端收到 conflict 后通常会带 force 重传「冲突标记版」，
			// 这条记录让 Web 端时间线能看到冲突发生本身
			s.logSync(c.VaultID, repository.ActionFileConflict, m.Path, "三方合并失败，返回服务端版本", 0, c.DeviceID, c.DeviceName)
			s.sendJSON(c, proto.Conflict{
				Type:          "conflict",
				Path:          m.Path,
				ServerHash:    ce.Server.ContentHash,
				ServerContent: ce.Server.Content,
				ServerMtime:   ce.Server.Mtime,
				MergedHint:    ce.Hint,
			})
			return
		}
		if errors.Is(err, service.ErrHashMismatch) {
			s.sendErr(c, "upload: hash mismatch for "+m.Path)
			return
		}
		s.sendErr(c, "db error: "+err.Error())
		return
	}

	s.sendJSON(c, proto.OK{
		Type:   "ok",
		For:    "upload",
		Path:   m.Path,
		Hash:   res.Note.ContentHash,
		Merged: res.Merged,
	})
	changed, _ := json.Marshal(proto.Changed{Type: "changed", Path: m.Path, Hash: res.Note.ContentHash})
	if res.Unchanged {
		// 内容与已存版本一致：纯回声（如 iCloud 与另一客户端同时到达），
		// 只确认给上传方，不广播，避免多客户端互相触发上传循环。
		log.Printf("[ws] upload %s (echo, unchanged) vault=%d device=%s… from %s", m.Path, c.VaultID, shortID(c.DeviceID), c.Conn.RemoteAddr())
		s.logSync(c.VaultID, repository.ActionFileEcho, m.Path, "", 0, c.DeviceID, c.DeviceName)
		s.advanceProgress(c.VaultID, m.Path)
		return
	}
	s.hub.BroadcastVault(c.VaultID, changed, c)
	action := repository.ActionFileUpdate
	switch {
	case res.Merged:
		action = repository.ActionFileMerge
	case res.Created:
		action = repository.ActionFileCreate
	}
	s.logSync(c.VaultID, action, m.Path, "", int64(len(res.Note.Content)), c.DeviceID, c.DeviceName)
	log.Printf("[ws] upload %s (%d bytes) vault=%d device=%s… from %s", m.Path, len(res.Note.Content), c.VaultID, shortID(c.DeviceID), c.Conn.RemoteAddr())
	s.advanceProgress(c.VaultID, m.Path)
}

// handleAttachmentUpload 附件上传：base64 落盘 + notes 表元数据 upsert + 广播
func (s *Server) handleAttachmentUpload(c *hub.Client, m proto.Upload) error {	ctx := context.Background()
	n, err := s.attach.Save(c.VaultID, m.Path, m.Content)
	if err != nil {
		return err
	}
	hash := m.Hash
	if hash == "" {
		if hash, err = s.attach.Hash(c.VaultID, m.Path); err != nil {
			return err
		}
	}
	// 附件不做三方合并：元数据直接 LWW upsert
	if err := s.repo.Upsert(ctx, &model.Note{
		VaultID: c.VaultID, Path: m.Path,
		Content: "", ContentHash: hash,
		Snapshot: "", SnapshotHash: "",
		Mtime: m.Mtime, Size: int64(n),
	}); err != nil {
		return err
	}
	s.sendJSON(c, proto.OK{Type: "ok", For: "upload", Path: m.Path, Hash: hash})
	changed, _ := json.Marshal(proto.Changed{Type: "changed", Path: m.Path, Hash: hash})
	s.hub.BroadcastVault(c.VaultID, changed, c)
	s.logSync(c.VaultID, repository.ActionFileCreate, m.Path, "附件", int64(n), c.DeviceID, c.DeviceName)
	log.Printf("[ws] upload attachment %s (%d bytes) vault=%d from %s", m.Path, n, c.VaultID, c.Conn.RemoteAddr())
	s.advanceProgress(c.VaultID, m.Path)
	return nil
}

// handleFetch 下发单个文件内容
func (s *Server) handleFetch(c *hub.Client, data []byte) {
	var m proto.Fetch
	if err := json.Unmarshal(data, &m); err != nil {
		s.sendErr(c, "bad fetch: "+err.Error())
		return
	}
	note, err := s.repo.GetByPath(context.Background(), c.VaultID, m.Path)
	if err != nil {
		s.sendErr(c, "fetch "+m.Path+": "+err.Error())
		return
	}
	content := note.Content
	// 附件：从文件系统读 base64
	if repository.IsAttachment(m.Path) {
		b64, _, err := s.attach.Load(c.VaultID, m.Path)
		if err != nil {
			s.sendErr(c, "fetch "+m.Path+": "+err.Error())
			return
		}
		content = b64
	}
	s.sendJSON(c, proto.FetchResponse{
		Type: "fetch_response", Path: note.Path, Hash: note.ContentHash,
		Content: content, Mtime: note.Mtime,
	})
	s.advanceProgress(c.VaultID, m.Path)
}

func (s *Server) handleRename(c *hub.Client, data []byte) {
	var m proto.Rename
	if err := json.Unmarshal(data, &m); err != nil {
		s.sendErr(c, "bad rename: "+err.Error())
		return
	}
	if err := s.repo.Rename(context.Background(), c.VaultID, m.From, m.To); err != nil {
		s.sendErr(c, "rename: "+err.Error())
		return
	}
	// 附件文件一并移动
	if repository.IsAttachment(m.To) {
		if err := s.attach.Rename(c.VaultID, m.From, m.To); err != nil {
			log.Printf("[ws] attachment rename %s -> %s: %v", m.From, m.To, err)
		}
	}
	s.sendJSON(c, proto.OK{Type: "ok", For: "rename", From: m.From, To: m.To, Path: m.To})
	msg, _ := json.Marshal(proto.Renamed{Type: "renamed", From: m.From, To: m.To})
	s.hub.BroadcastVault(c.VaultID, msg, c)
	s.logSync(c.VaultID, repository.ActionFileRename, m.From+" → "+m.To, "", 0, c.DeviceID, c.DeviceName)
	log.Printf("[ws] rename %s -> %s vault=%d from %s", m.From, m.To, c.VaultID, c.Conn.RemoteAddr())
}

func (s *Server) handleDelete(c *hub.Client, data []byte) {
	var m proto.Delete
	if err := json.Unmarshal(data, &m); err != nil {
		s.sendErr(c, "bad delete: "+err.Error())
		return
	}
	if m.Path == "" {
		s.sendErr(c, "delete: empty path")
		return
	}
	if err := s.repo.DeleteByPath(context.Background(), c.VaultID, m.Path); err != nil && !errors.Is(err, repository.ErrNotFound) {
		s.sendErr(c, "delete: "+err.Error())
		return
	}
	// 连带清理该笔记的分享记录（有则删，无则跳过）
	if s.share != nil {
		if n, err := s.repo.GetByPath(context.Background(), c.VaultID, m.Path); err == nil {
			_ = s.share.DeleteByNoteID(context.Background(), n.ID)
		}
	}
	// 附件文件一并删除
	if repository.IsAttachment(m.Path) {
		if err := s.attach.Delete(c.VaultID, m.Path); err != nil {
			log.Printf("[ws] attachment delete %s: %v", m.Path, err)
		}
	}
	s.sendJSON(c, proto.OK{Type: "ok", For: "delete", Path: m.Path})
	msg, _ := json.Marshal(proto.Deleted{Type: "deleted", Path: m.Path})
	s.hub.BroadcastVault(c.VaultID, msg, c)
	s.logSync(c.VaultID, repository.ActionFileDelete, m.Path, "", 0, c.DeviceID, c.DeviceName)
	log.Printf("[ws] delete %s vault=%d from %s", m.Path, c.VaultID, c.Conn.RemoteAddr())
}

// ---------- 同步进度跟踪（Web 端展示用） ----------

// setSyncProgress 对账后设置本次同步的待完成路径，并推送进度事件
func (s *Server) setSyncProgress(vaultID int64, diffs []proto.HashListDiff) {
	if len(diffs) == 0 {
		return
	}
	s.progressMu.Lock()
	if s.progress == nil {
		s.progress = make(map[int64]*syncProgress)
	}
	p := &syncProgress{total: len(diffs), paths: make(map[string]struct{}, len(diffs))}
	for _, d := range diffs {
		p.paths[d.Path] = struct{}{}
	}
	s.progress[vaultID] = p
	s.progressMu.Unlock()
	s.publishProgress(vaultID, p.total, 0)
}

// advanceProgress 某个路径完成（upload 或 fetch 响应）时推进进度
func (s *Server) advanceProgress(vaultID int64, path string) {
	s.progressMu.Lock()
	p := s.progress[vaultID]
	if p == nil {
		s.progressMu.Unlock()
		return
	}
	if _, ok := p.paths[path]; !ok {
		s.progressMu.Unlock()
		return
	}
	delete(p.paths, path)
	p.done++
	total, done := p.total, p.done
	finished := false
	if done >= total {
		delete(s.progress, vaultID)
		finished = true
	}
	s.progressMu.Unlock()
	s.publishProgress(vaultID, total, done)
	// 全部完成后额外推一条 sync_done：Web 端据此刷新文件树（先写库后推进度，
	// 所以事件到达时数据已落库）
	if finished {
		s.publishSyncDone(vaultID)
	}
}

// publishSyncDone 推送同步完成事件给 Web 端（SSE）
func (s *Server) publishSyncDone(vaultID int64) {
	if s.eventHub == nil {
		return
	}
	s.eventHub.Publish(events.Event{
		Type:    "vault.sync_done",
		VaultID: vaultID,
	})
}

// publishProgress 通过 SSE 推送同步进度给 Web 端
func (s *Server) publishProgress(vaultID int64, total, done int) {
	if s.eventHub == nil {
		return
	}
	s.eventHub.Publish(events.Event{
		Type:    "vault.progress",
		VaultID: vaultID,
		Total:   total,
		Done:    done,
	})
}

// handleBye 客户端主动断开绑定（插件「断开并取消授权」）：
// 删除设备记录；vault 无剩余 active 设备时清掉授权状态，
// 让 Web 端立即回到「未授权」。
func (s *Server) handleBye(c *hub.Client, data []byte) {
	var m proto.Bye
	if err := json.Unmarshal(data, &m); err != nil {
		return // bye 失败不阻断断开流程
	}
	deviceID := m.DeviceID
	if deviceID == "" {
		deviceID = c.DeviceID
	}
	ctx := context.Background()
	if err := s.deviceRepo.Unbind(ctx, c.VaultID, deviceID); err != nil {
		log.Printf("[ws] bye unbind error: %v", err)
		return
	}
	// 被解绑的恰是单设备同步 pin 的设备：pin 指向已删除的设备记录，
	// 不清掉会让后续所有设备（含重新授权的）认证全部被拒
	if v, err := s.vaultRepo.GetByID(ctx, c.VaultID); err == nil &&
		v.SingleDevice && v.PinnedDeviceID == deviceID {
		_ = s.vaultRepo.SetSingleDevice(ctx, c.VaultID, false, "")
		log.Printf("[ws] bye vault=%d: unbound device was pinned, single-device sync disabled", c.VaultID)
	}
	cleared := false
	// 没有其他 active 设备 -> 清 vault 授权状态
	if active, err := s.deviceRepo.HasActive(ctx, c.VaultID); err == nil && !active {
		_ = s.vaultRepo.ClearAuth(ctx, c.VaultID)
		cleared = true
	}
	s.sendJSON(c, proto.OK{Type: "ok", For: "bye"})
	// 解绑留痕：设备记录已删，从连接上取设备名
	s.logSync(c.VaultID, repository.ActionDevUnbind, "", "", 0, deviceID, c.DeviceName)
	log.Printf("[ws] bye vault=%d device=%s (unbound)", c.VaultID, deviceID)
	// 通知 Web 端：解绑/清授权
	if s.eventHub != nil {
		s.eventHub.Publish(events.Event{
			Type:     "vault.unbound",
			VaultID:  c.VaultID,
			DeviceID: deviceID,
		})
		if cleared {
			s.eventHub.Publish(events.Event{
				Type:    "vault.unauthorized",
				VaultID: c.VaultID,
			})
		}
	}
}

// ---------- 工具 ----------

func (s *Server) sendJSON(c *hub.Client, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case c.Send <- data:
	default: // 队列满跳过，靠对账兜底
	}
}

func (s *Server) sendErr(c *hub.Client, msg string) {
	s.sendJSON(c, proto.Err{Type: "error", Message: msg})
}
