package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"owiki/internal/model"
	"owiki/internal/repository"

	agui "github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"
	"github.com/gin-gonic/gin"
	"trpc.group/trpc-go/trpc-agent-go/event"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
	"trpc.group/trpc-go/trpc-agent-go/session"
)

// RegisterAPI 挂内置 AI 对话的全部端点（需登录 + feature 门禁由路由组外层套）。
// 事件协议：AG-UI（https://ag-ui.com）。SSE 帧不带 event: 行，type 在 data JSON 里；
// 前端解析见 web/src/lib/agui/。
func RegisterAPI(api *gin.RouterGroup, mgr *Manager, settings *repository.AISettingsRepo) {
	g := api.Group("/chat")

	// ---- 配置读写（语义与旧版一致） ----
	g.GET("/settings", func(c *gin.Context) {
		a, err := settings.Load(c.Request.Context())
		if err != nil {
			a = &model.AISettings{}
		}
		c.JSON(http.StatusOK, gin.H{
			"enabled":     a.Enabled,
			"ready":       a.Ready(),
			"baseUrl":     a.BaseURL,
			"model":       a.Model,
			"apiKeySet":   a.APIKey != "",
			"lastTestOk":  a.LastTestOK,
			"lastTestAt":  a.LastTestAt,
			"lastTestErr": a.LastTestErr,
		})
	})

	g.PUT("/settings", func(c *gin.Context) {
		var body struct {
			Enabled bool   `json:"enabled"`
			BaseURL string `json:"baseUrl"`
			APIKey  string `json:"apiKey"`
			Model   string `json:"model"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// 空 key = 保留已存值
		if err := settings.Update(c.Request.Context(), func(a *model.AISettings) {
			a.Enabled = body.Enabled
			a.BaseURL = body.BaseURL
			a.Model = body.Model
			if body.APIKey != "" {
				a.APIKey = body.APIKey
			}
			// 三项或端点变了，上次测试结果作废
			if a.BaseURL != body.BaseURL || a.Model != body.Model || body.APIKey != "" {
				a.LastTestOK = false
				a.LastTestErr = ""
			}
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		mgr.Invalidate()
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	g.POST("/settings/test", func(c *gin.Context) {
		a, _ := settings.Load(c.Request.Context())
		if a == nil {
			a = &model.AISettings{}
		}
		// 允许「先测未保存的表单值」：body 带了就用 body 的
		var body struct {
			BaseURL string `json:"baseUrl"`
			APIKey  string `json:"apiKey"`
			Model   string `json:"model"`
		}
		_ = c.ShouldBindJSON(&body)
		baseURL, key, mdl := a.BaseURL, a.APIKey, a.Model
		if body.BaseURL != "" {
			baseURL = body.BaseURL
		}
		if body.APIKey != "" {
			key = body.APIKey
		}
		if body.Model != "" {
			mdl = body.Model
		}
		if baseURL == "" || key == "" || mdl == "" {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "baseUrl / apiKey / model required"})
			return
		}
		err := testConnection(c.Request.Context(), baseURL, key, mdl)
		now := time.Now()
		// 只回写「已保存配置与被测配置一致」的结果，避免手滑测挂入口消失
		if saved, e := settings.Load(c.Request.Context()); e == nil &&
			saved.BaseURL == baseURL && saved.Model == mdl && saved.APIKey == key {
			saved.LastTestOK = err == nil
			saved.LastTestAt = now
			if err != nil {
				saved.LastTestErr = err.Error()
			} else {
				saved.LastTestErr = ""
			}
			_ = settings.Save(c.Request.Context(), saved)
			mgr.Invalidate()
		}
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "model": mdl})
	})

	// ---- 对话流（AG-UI over SSE） ----
	g.POST("/sessions/:sid/stream", func(c *gin.Context) {
		sid := c.Param("sid")
		var body struct {
			Message string `json:"message"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "message required"})
			return
		}
		r, err := mgr.Runner(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		runID := newRunID()
		runCtx, cancelRun := context.WithCancel(WithRunID(c.Request.Context(), runID))
		defer cancelRun()

		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")

		em := NewAgentEmitter(runCtx, c.Writer, cancelRun)
		// 确认帧直写本流：per-run emitter（多标签页互不串）
		mgr.Broker().SetEmitter(runID, func(name string, data any) {
			em.Write(agui.NewCustomEvent(name, agui.WithValue(data)))
			em.Flush()
		})
		defer mgr.Broker().SetEmitter(runID, nil)

		mapper := newAGUIMapper(runID, sid)
		em.Write(mapper.Started())
		em.Flush()

		// 心跳：长工具执行期间防代理掐断（每 15s 一条注释帧）
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		hbDone := make(chan struct{})
		defer close(hbDone)
		go func() {
			for {
				select {
				case <-hbDone:
					return
				case <-heartbeat.C:
					if _, err := c.Writer.WriteString(": ping\n\n"); err == nil {
						c.Writer.Flush()
					}
				}
			}
		}()

		evCh, err := r.Run(runCtx, UserID, sid, trpcmodel.NewUserMessage(body.Message))
		if err != nil {
			em.Write(mapper.Error(err.Error()))
			em.WriteAll(mapper.Finished())
			em.Flush()
			return
		}
		for ev := range evCh {
			if ev != nil && ev.Response != nil && ev.Response.Error != nil {
				log.Printf("agent stream error sid=%s run=%s type=%s msg=%s",
					sid, runID, ev.Response.Error.Type, ev.Response.Error.Message)
			}
			em.WriteAll(mapper.MapEvent(destructureTrpc(ev)))
			em.Flush()
			if em.Err() != nil {
				break // 客户端断开，写侧已 cancel run ctx
			}
		}
		// 结束：补发仍未决的 confirm 撤销 + RUN_FINISHED
		if pending := mgr.Broker().Pending(runID); pending != nil {
			mgr.Broker().Resolve(runID, false)
		}
		em.WriteAll(mapper.Finished())
		em.Flush()
	})

	// ---- 危险工具确认 ----
	g.POST("/runs/:runId/confirm", func(c *gin.Context) {
		runID := c.Param("runId")
		var body struct {
			Approved bool `json:"approved"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !mgr.Broker().Resolve(runID, body.Approved) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no pending confirm"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// ---- 会话列表 ----
	g.GET("/sessions", func(c *gin.Context) {
		svc := NewSessionService(mgr.store)
		sessions, err := svc.ListSessions(c.Request.Context(), userKey())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]gin.H, 0, len(sessions))
		for _, s := range sessions {
			out = append(out, gin.H{"id": s.ID, "updatedAt": s.UpdatedAt})
		}
		c.JSON(http.StatusOK, gin.H{"data": out})
	})

	// ---- 会话历史回放：持久化 trpc 事件重放过同一套 AG-UI 映射 ----
	// 与直播同代码路径——工具活动/reasoning 刷新后不丢。
	g.GET("/sessions/:sid/events", func(c *gin.Context) {
		sid := c.Param("sid")
		raws, err := mgr.store.LoadEvents(c.Request.Context(), sid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		mapper := newAGUIMapper("replay", sid)
		var out []json.RawMessage
		for _, raw := range raws {
			var e event.Event
			if err := json.Unmarshal(raw, &e); err != nil {
				continue
			}
			for _, ev := range mapper.MapEvent(destructureTrpc(&e)) {
				b, err := ev.ToJSON()
				if err != nil {
					continue
				}
				out = append(out, b)
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": out})
	})

	// ---- 删会话 ----
	g.DELETE("/sessions/:sid", func(c *gin.Context) {
		sid := c.Param("sid")
		if err := mgr.store.DeleteSession(c.Request.Context(), AppName, UserID, sid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_ = mgr.store.DeleteSessionState(c.Request.Context(), sid)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

func userKey() session.UserKey {
	return session.UserKey{AppName: AppName, UserID: UserID}
}

func newRunID() string {
	buf := make([]byte, 10)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
