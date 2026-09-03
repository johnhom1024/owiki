package webapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"owiki/internal/events"
	"owiki/internal/hub"
	"owiki/internal/proto"
	"owiki/internal/repository"
	"owiki/internal/service"

	"github.com/gin-gonic/gin"
)

// shortID 设备标识缩略（日志用），与 ws 包内同名逻辑保持一致
func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

// syncStateMessage 单设备同步开关/pin 变化时推给在线客户端的说明文案
func syncStateMessage(vaultName string, singleDevice, enabled bool) string {
	if !singleDevice {
		return "单设备同步已关闭，本设备恢复同步"
	}
	if enabled {
		return "本设备已被选为同步设备，开始同步"
	}
	return "vault「" + vaultName + "」已开启单设备同步，本设备未被选中：连接保持，但文件变更不会同步。可在 OWiki Web 管理端更换选定设备"
}

// RegisterVaultRoutes vault 管理 + vault 作用域的文件 API。
// api 传入的是已挂登录中间件的 /api 组。
func RegisterVaultRoutes(api *gin.RouterGroup, vaultRepo *repository.VaultRepo, repo *repository.NoteRepo, deviceRepo *repository.DeviceRepo, h *hub.Hub, eventHub *events.Hub, attach *repository.AttachStore, syncLog *repository.SyncLogRepo, shareRepo *repository.ShareRepo) {

	// ---------- vault CRUD ----------

	api.GET("/vaults", func(c *gin.Context) {
		vaults, err := vaultRepo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 附带每个 vault 的统计、在线连接数、授权状态
		type vaultWithStats struct {
			ID         int64  `json:"id"`
			Name       string `json:"name"`
			Note       string `json:"note"`
			CreatedAt  string `json:"createdAt"`
			UpdatedAt  string `json:"updatedAt"`
			Authorized bool   `json:"authorized"`
			LastSeenAt string `json:"lastSeenAt"`
			Files      int64  `json:"files"`
			Size       int64  `json:"size"`
			Clients    int    `json:"clients"`
		}
		out := make([]vaultWithStats, 0, len(vaults))
		for _, v := range vaults {
			s, _ := repo.Stats(c.Request.Context(), v.ID)
			seen := ""
			if v.LastSeenAt != nil {
				seen = v.LastSeenAt.Format("2006-01-02 15:04:05")
			}
			// authorized = 还有绑定的（未吊销）设备；全部 bye 解绑/吊销后即未授权
			authorized, _ := deviceRepo.HasActive(c.Request.Context(), v.ID)
			out = append(out, vaultWithStats{
				ID: v.ID, Name: v.Name, Note: v.Note,
				CreatedAt: v.CreatedAt.Format("2006-01-02 15:04:05"),
				UpdatedAt: v.UpdatedAt.Format("2006-01-02 15:04:05"),
				Authorized: authorized, LastSeenAt: seen,
				Files:   s.TotalFiles,
				Size:    s.TotalSize,
				Clients: h.CountVault(v.ID),
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": out, "total": len(out)})
	})

	api.POST("/vaults", func(c *gin.Context) {
		var body struct {
			Name string `json:"name" binding:"required"`
			Note string `json:"note"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
			return
		}
		v, err := vaultRepo.Create(c.Request.Context(), body.Name, body.Note)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": v})
	})

	api.GET("/vaults/:vid", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		v, err := vaultRepo.GetByID(c.Request.Context(), vid)
		if errors.Is(err, repository.ErrVaultNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		s, _ := repo.Stats(c.Request.Context(), vid)
		authorized, _ := deviceRepo.HasActive(c.Request.Context(), vid)
		lastSeen := ""
		if v.LastSeenAt != nil {
			lastSeen = v.LastSeenAt.Format("2006-01-02 15:04:05")
		}
		c.JSON(http.StatusOK, gin.H{
			"data":       v,
			"stats":      s,
			"clients":    h.CountVault(vid),
			"authorized": authorized,
			"lastSeenAt": lastSeen,
		})
	})

	api.PUT("/vaults/:vid", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		var body struct {
			Name string `json:"name"`
			Note string `json:"note"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		v, err := vaultRepo.Update(c.Request.Context(), vid, body.Name, body.Note)
		if errors.Is(err, repository.ErrVaultNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": v})
	})

	// 单设备同步设置：独立端点，避免与基本信息的 PUT 相互覆盖
	// （singleDevice=false 时 pinnedDeviceId 传空串即关闭该模式）
	api.PUT("/vaults/:vid/single-device", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		var body struct {
			SingleDevice   bool   `json:"singleDevice"`
			PinnedDeviceID string `json:"pinnedDeviceId"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.SingleDevice && body.PinnedDeviceID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "开启单设备同步必须选择一个设备"})
			return
		}
		v, err := vaultRepo.GetByID(c.Request.Context(), vid)
		if errors.Is(err, repository.ErrVaultNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if body.SingleDevice {
			// 校验目标设备确实登记过本 vault（授权与同步解耦后，
			// 单设备模式下连接的设备也会进列表，都能被选为 pin）
			devices, err := deviceRepo.List(c.Request.Context(), vid)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			found := false
			for _, d := range devices {
				if d.DeviceID == body.PinnedDeviceID {
					found = true
					break
				}
			}
			if !found {
				c.JSON(http.StatusBadRequest, gin.H{"error": "所选设备未授权过此 vault"})
				return
			}
		} else {
			body.PinnedDeviceID = ""
		}
		v.SingleDevice = body.SingleDevice
		v.PinnedDeviceID = body.PinnedDeviceID
		if err := vaultRepo.Save(c.Request.Context(), v); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 在线推送同步资格变化：被静默的设备原地降级（连接保持），
		// 被恢复的设备原地升级（客户端收到 sync_state 补对账）。
		// 不再踢线——授权/心跳/解绑不受单设备模式影响。
		h.PushSyncState(vid, func(deviceID string) bool {
			return !v.SingleDevice || deviceID == v.PinnedDeviceID
		}, func(enabled bool) []byte {
			msg, _ := json.Marshal(proto.SyncState{
				Type: "sync_state", SyncEnabled: enabled,
				Message: syncStateMessage(v.Name, v.SingleDevice, enabled),
			})
			return msg
		})
		log.Printf("[web] vault=%q singleDevice=%v pinned=%s", v.Name, v.SingleDevice, shortID(v.PinnedDeviceID))
		c.JSON(http.StatusOK, gin.H{"data": v})
	})

	api.DELETE("/vaults/:vid", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		if err := vaultRepo.Delete(c.Request.Context(), vid); err != nil {
			if errors.Is(err, repository.ErrVaultNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 连带清掉该 vault 的全部笔记、设备记录与同步日志
		if err := repo.DeleteByVault(c.Request.Context(), vid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_ = deviceRepo.DeleteByVault(c.Request.Context(), vid)
		_ = syncLog.DeleteByVault(c.Request.Context(), vid)
		_ = shareRepo.DeleteByVault(c.Request.Context(), vid)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// ---------- vault 同步令牌管理 ----------

	// 取令牌 + 一键授权链接（仅在创建后/设置页展示，list 接口不吐）
	api.GET("/vaults/:vid/token", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		v, err := vaultRepo.GetByID(c.Request.Context(), vid)
		if errors.Is(err, repository.ErrVaultNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"token":         v.Token,
			"serverUrl":     wsURLFromRequest(c),
			"obsidianOAuth": obsidianOAuthURL(v.Name, v.Token, c),
		})
	})

	// 重置令牌（旧插件的 token 立即失效）
	api.POST("/vaults/:vid/token/rotate", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		token, err := vaultRepo.RotateToken(c.Request.Context(), vid)
		if err != nil {
			if errors.Is(err, repository.ErrVaultNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		v, _ := vaultRepo.GetByID(c.Request.Context(), vid)
		c.JSON(http.StatusOK, gin.H{
			"token":         token,
			"serverUrl":     wsURLFromRequest(c),
			"obsidianOAuth": obsidianOAuthURL(v.Name, token, c),
		})
	})

	// 取消授权（全部设备）：删除全部设备记录 + 作废旧令牌 + 清授权状态 + 踢掉全部连接
	api.POST("/vaults/:vid/revoke", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		if _, err := vaultRepo.GetByID(c.Request.Context(), vid); err != nil {
			if errors.Is(err, repository.ErrVaultNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "vault not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// ① 删除全部已登记设备记录
		if err := deviceRepo.DeleteByVault(c.Request.Context(), vid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// ② 作废令牌（旧客户端即使重连也认证不过）
		if _, err := vaultRepo.RotateToken(c.Request.Context(), vid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// ③ 清除授权状态（Web 端回到「未授权」）
		if err := vaultRepo.ClearAuth(c.Request.Context(), vid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// ③' 清掉单设备同步 pin：设备记录已全部删除，
		// 残留的 pin 会让重新授权的设备全部被拒，卡死整个 vault
		if err := vaultRepo.SetSingleDevice(c.Request.Context(), vid, false, ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// ④ 踢掉该 vault 当前所有连接
		h.CloseVault(vid)
		c.JSON(http.StatusOK, gin.H{"ok": true})
		// 通知 Web 端：彻底取消授权
		eventHub.Publish(events.Event{Type: "vault.unauthorized", VaultID: vid})
	})

	// ---------- 设备管理 ----------

	// 已授权设备列表
	api.GET("/vaults/:vid/devices", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		devices, err := deviceRepo.List(c.Request.Context(), vid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": devices})
	})

	// 同步日志：游标分页（新→旧）。?before=<id>&limit=&type=changes|deletes|conflicts
	api.GET("/vaults/:vid/logs", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		before, _ := strconv.ParseInt(c.Query("before"), 10, 64)
		limit, _ := strconv.Atoi(c.Query("limit"))
		// 过滤器 → 动作集合
		var actions []string
		switch c.Query("type") {
		case "changes":
			actions = []string{repository.ActionFileCreate, repository.ActionFileUpdate, repository.ActionFileMerge}
		case "deletes":
			actions = []string{repository.ActionFileDelete}
		case "conflicts":
			actions = []string{repository.ActionFileConflict, repository.ActionFileMerge}
		}
		logs, hasMore, err := syncLog.ListPage(c.Request.Context(), vid, before, limit, actions)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": logs, "hasMore": hasMore})
	})

	// ---------- vault 作用域的文件 API ----------

	vg := api.Group("/vaults/:vid", func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		if _, err := vaultRepo.GetByID(c.Request.Context(), vid); err != nil {
			if errors.Is(err, repository.ErrVaultNotFound) {
				c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "vault not found"})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Set("vid", vid)
	})

	vg.GET("/files", func(c *gin.Context) {
		notes, err := repo.ListAll(c.Request.Context(), c.GetInt64("vid"), false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": notes, "total": len(notes)})
	})

	// Web 端新建笔记：路径不存在才创建，广播到已连接的 Obsidian。
	vg.POST("/files", func(c *gin.Context) {
		vid := c.GetInt64("vid")
		var body struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		p, err := repository.NormalizeNotePath(body.Path)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}
		if _, err := repo.GetByPath(c.Request.Context(), vid, p); err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "note already exists"})
			return
		} else if !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		content := body.Content
		if content == "" {
			content = "# " + repository.NoteTitleFromPath(p) + "\n"
		}
		res, err := service.Save(c.Request.Context(), repo, service.SaveInput{
			VaultID: vid,
			Path:    p,
			Content: content,
			Mtime:   time.Now().Unix(),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if h != nil {
			msg, _ := json.Marshal(proto.Changed{Type: "changed", Path: res.Note.Path, Hash: res.Note.ContentHash})
			h.BroadcastVault(vid, msg, nil)
		}
		if syncLog != nil {
			syncLog.Record(c.Request.Context(), vid, repository.ActionFileCreate, res.Note.Path, "Web 端新建", repository.SourceWeb, "", "Web 管理端", int64(len(res.Note.Content)))
		}
		if eventHub != nil {
			eventHub.Publish(events.Event{Type: "vault.log", VaultID: vid})
			eventHub.Publish(events.Event{Type: "vault.sync_done", VaultID: vid})
		}
		c.JSON(http.StatusCreated, gin.H{"data": res.Note})
	})

	vg.GET("/files/:id", func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		note, err := repo.GetByID(c.Request.Context(), c.GetInt64("vid"), id, false)
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, note)
	})

	// 按路径解析文件 id（首页「最近动态」点击跳详情用）：?path=日记/2026-09-02.md
	vg.GET("/resolve", func(c *gin.Context) {
		path := c.Query("path")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
			return
		}
		note, err := repo.GetByPath(c.Request.Context(), c.GetInt64("vid"), path)
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": note})
	})

	// 附件下载：<img src="/api/vaults/:vid/attachments/*path">
	vg.GET("/attachments/*path", func(c *gin.Context) {
		path := c.Param("path")[1:] // 去掉前导 /
		if path == "" || !repository.IsAttachment(path) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid attachment path"})
			return
		}
		// 必须在 notes 表里有记录（防止任意文件读取）
		if _, err := repo.GetByPath(c.Request.Context(), c.GetInt64("vid"), path); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		data, err := attach.LoadBytes(c.GetInt64("vid"), path)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "attachment data missing"})
			return
		}
		c.Header("Cache-Control", "private, max-age=86400")
		c.Data(http.StatusOK, repository.ContentType(path), data)
	})

	vg.GET("/stats", func(c *gin.Context) {
		s, err := repo.Stats(c.Request.Context(), c.GetInt64("vid"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, s)
	})

	// SSE 事件流：把 vault 授权/取消授权/解绑等状态变化实时推到 Web 端，
	// Web 订阅 EventSource 收到后自动重查相应接口，无需轮询/手动刷新。
	// 连接断开时 Unsubscribe，hub 端会被清掉。
	api.GET("/events", func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no") // 关掉 nginx 缓冲

		sub := eventHub.Subscribe()
		defer eventHub.Unsubscribe(sub)

		// 初始 hello 事件：让 Web 端知道连接已通
		c.SSEvent("hello", gin.H{"ts": time.Now().UnixMilli()})
		c.Writer.Flush()

		// 30s 心跳：防止代理/浏览器超时断流
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-c.Request.Context().Done():
				return
			case ev, ok := <-sub:
				if !ok {
					return
				}
				c.SSEvent("vault", ev)
				c.Writer.Flush()
			case <-ticker.C:
				// SSE 注释行（以 : 开头）做心跳
				if _, err := c.Writer.Write([]byte(": keepalive\n\n")); err != nil {
					return
				}
				c.Writer.Flush()
			}
		}
	})
}

// wsURLFromRequest 从当前请求推出给插件用的 WebSocket 地址。
// 生产环境经过多层反代（Traefik → frp → …）：X-Forwarded-Proto 可能被中间
// 某一跳覆盖成 http，也可能按逐跳追加成 "https,http"，所以不能只做全等比较，
// 只要转发链里出现过 https（或 X-Forwarded-Ssl: on）就按 wss 推出。
func wsURLFromRequest(c *gin.Context) string {
	scheme := "ws"
	if c.Request.TLS != nil ||
		strings.Contains(c.GetHeader("X-Forwarded-Proto"), "https") ||
		strings.EqualFold(c.GetHeader("X-Forwarded-Ssl"), "on") {
		scheme = "wss"
	}
	return scheme + "://" + c.Request.Host + "/ws"
}

// obsidianOAuthURL 生成 obsidian:// 一键授权深链：
// 插件注册 owiki-sync 协议 action，收到后自动写入 serverUrl+token 并连接。
// 注意参数名不能叫 vault——那是 Obsidian 内置 URI 参数（obsidian://open?vault=），
// 用了会被 Obsidian 抢先拿去按名字找 vault，报 "Unable to find a vault for the URL"。
func obsidianOAuthURL(vaultName, token string, c *gin.Context) string {
	q := url.Values{}
	q.Set("server", wsURLFromRequest(c))
	q.Set("token", token)
	q.Set("vaultName", vaultName)
	return "obsidian://owiki-sync?action=authorize&" + q.Encode()
}
