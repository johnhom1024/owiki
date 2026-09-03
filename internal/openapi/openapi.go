// Package openapi 开放接口：给 AI agent / 外部脚本调用的 REST API。
// 认证：请求头 X-API-Key: owk_xxx（在 Web 端「API 密钥」页生成）。
//
// 设计原则：
//   - 只读接口宽松（列表/读取/搜索），写接口显式（创建/更新/删除）
//   - 路径语义与 vault 内 Obsidian 路径一致（如 "日记/2026-08.md"）
//   - 响应统一 {data: ...}；错误 {error: "..."}
package openapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"owiki/internal/hub"
	"owiki/internal/model"
	"owiki/internal/repository"
	"owiki/internal/service"

	"github.com/gin-gonic/gin"
)

// Register 挂载 /openapi/* 路由 + 管理端 /api/apikeys
// adminAPI 传入的是已挂登录中间件的 /api 组（apikeys 管理属于 Web 端）。
func Register(r *gin.Engine, repo *repository.NoteRepo, vaultRepo *repository.VaultRepo, apiKeyRepo *repository.ApiKeyRepo, attach *repository.AttachStore, h *hub.Hub, adminAPI *gin.RouterGroup, syncLog *repository.SyncLogRepo, share *repository.ShareRepo) {
	oa := &openAPI{repo: repo, vaultRepo: vaultRepo, keys: apiKeyRepo, attach: attach, hub: h, syncLog: syncLog, share: share}

	// ---------- AI/脚本调用的开放接口 ----------
	g := r.Group("/openapi")
	g.Use(oa.auth())
	{
		g.GET("/vaults", oa.listVaults)
		g.GET("/vaults/:vid/notes", oa.listNotes)
		g.GET("/vaults/:vid/notes/*path", oa.getNote)
		g.POST("/vaults/:vid/notes/*path", oa.upsertNote)
		g.PATCH("/vaults/:vid/notes/*path", oa.renameNote)
		g.DELETE("/vaults/:vid/notes/*path", oa.deleteNote)
		g.GET("/vaults/:vid/search", oa.search)
	}

	// ---------- Web 管理端（需登录，与 /api 同域 cookie 认证） ----------
	m := adminAPI.Group("/apikeys")
	{
		m.GET("", func(c *gin.Context) {
			keys, err := apiKeyRepo.List(c.Request.Context())
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": keys})
		})
		m.POST("", func(c *gin.Context) {
			var body struct {
				Name       string `json:"name"`
				VaultScope int64  `json:"vaultScope"`
				ReadOnly   bool   `json:"readOnly"`
			}
			if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
				return
			}
			plaintext, hash, prefix := repository.GenerateApiKey()
			k, err := apiKeyRepo.Create(c.Request.Context(), strings.TrimSpace(body.Name), hash, prefix, body.VaultScope, body.ReadOnly)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			// 明文只此一次
			c.JSON(http.StatusCreated, gin.H{"data": k, "apiKey": plaintext})
		})
		m.DELETE("/:id", func(c *gin.Context) {
			id, err := strconv.ParseInt(c.Param("id"), 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
				return
			}
			if err := apiKeyRepo.Delete(c.Request.Context(), id); err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})
	}
}

type openAPI struct {
	repo      *repository.NoteRepo
	vaultRepo *repository.VaultRepo
	keys      *repository.ApiKeyRepo
	attach    *repository.AttachStore
	hub       *hub.Hub
	syncLog   *repository.SyncLogRepo
	share     *repository.ShareRepo
}

// auth X-API-Key 校验 + vault 作用域检查
func (oa *openAPI) auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("X-API-Key")
		if key == "" {
			// 也接受 Authorization: Bearer owk_xxx（AI 工具常默认用 Bearer）
			auth := c.GetHeader("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				key = strings.TrimPrefix(auth, "Bearer ")
			}
		}
		if key == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing X-API-Key header"})
			return
		}
		k, ok := oa.keys.Verify(c.Request.Context(), key)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid api key"})
			return
		}
		c.Set("apiKey", k)
		oa.keys.TouchKey(c.Request.Context(), k.ID)
	}
}

// vaultScope 检查目标 vault 是否在本 key 允许范围
func (oa *openAPI) allowedVault(c *gin.Context, vid int64) bool {
	k := c.MustGet("apiKey").(*model.ApiKey)
	return k.VaultScope == 0 || k.VaultScope == vid
}

// parseVid 解析 + 校验 vault 作用域
func (oa *openAPI) parseVid(c *gin.Context) (int64, bool) {
	vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
		return 0, false
	}
	if !oa.allowedVault(c, vid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "vault not in key scope"})
		return 0, false
	}
	return vid, true
}

// cleanPath 把 /*path 参数转成 vault 内相对路径
func cleanPath(c *gin.Context) string {
	return strings.TrimPrefix(c.Param("path"), "/")
}

// ---------- handlers ----------

func (oa *openAPI) listVaults(c *gin.Context) {
	vaults, err := oa.vaultRepo.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	k := c.MustGet("apiKey").(*model.ApiKey)
	type v struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
		Note string `json:"note"`
	}
	out := make([]v, 0, len(vaults))
	for _, vv := range vaults {
		if k.VaultScope != 0 && k.VaultScope != vv.ID {
			continue
		}
		out = append(out, v{ID: vv.ID, Name: vv.Name, Note: vv.Note})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (oa *openAPI) listNotes(c *gin.Context) {
	vid, ok := oa.parseVid(c)
	if !ok {
		return
	}
	// ?full=1 返回内容（默认只给元数据，列表更轻）
	var notes []model.Note
	var err error
	if c.Query("full") == "1" {
		notes, err = oa.repo.ListWithContent(c.Request.Context(), vid)
	} else {
		notes, err = oa.repo.ListAll(c.Request.Context(), vid, false)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": notes, "total": len(notes)})
}

func (oa *openAPI) getNote(c *gin.Context) {
	vid, ok := oa.parseVid(c)
	if !ok {
		return
	}
	path := cleanPath(c)
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
		return
	}
	note, err := oa.repo.GetByPath(c.Request.Context(), vid, path)
	if errors.Is(err, repository.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found: " + path})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 附件：返回元数据 + 下载 URL（内容是二进制）
	if repository.IsAttachment(path) {
		c.JSON(http.StatusOK, gin.H{"data": note, "downloadUrl": "/openapi/vaults/" + c.Param("vid") + "/notes/" + path})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": note})
}

func (oa *openAPI) upsertNote(c *gin.Context) {
	vid, ok := oa.parseVid(c)
	if !ok {
		return
	}
	path := cleanPath(c)
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
		return
	}
	var body struct {
		Content   string `json:"content"`
		Mtime     int64  `json:"mtime"`
		BaseHash  string `json:"baseHash"`
		Force     bool   `json:"force"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := WriteNote(c.Request.Context(), oa.repo, oa.syncLog, oa.hub, vid, path, body.Content, body.BaseHash, body.Force, repository.SourceOpenAPI, "开放 API")
	if err != nil {
		var ce *service.ConflictError
		if errors.As(err, &ce) {
			c.JSON(http.StatusConflict, gin.H{
				"error": "conflict: note modified concurrently; retry with force=true or merge manually",
				"serverHash": ce.Server.ContentHash,
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res.Note, "merged": res.Merged})
}

func (oa *openAPI) renameNote(c *gin.Context) {
	vid, ok := oa.parseVid(c)
	if !ok {
		return
	}
	path := cleanPath(c)
	var body struct {
		To string `json:"to"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.To == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "to required"})
		return
	}
	if err := RenameNote(c.Request.Context(), oa.repo, oa.attach, oa.syncLog, oa.hub, vid, path, body.To, repository.SourceOpenAPI, "开放 API"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "from": path, "to": body.To})
}

func (oa *openAPI) deleteNote(c *gin.Context) {
	vid, ok := oa.parseVid(c)
	if !ok {
		return
	}
	path := cleanPath(c)
	if err := DeleteNote(c.Request.Context(), oa.repo, oa.attach, oa.share, oa.syncLog, oa.hub, vid, path, 0, repository.SourceOpenAPI, "开放 API"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// search 简单子串搜索（title/content），后续可换 FTS
func (oa *openAPI) search(c *gin.Context) {
	vid, ok := oa.parseVid(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "q required"})
		return
	}
	notes, err := oa.repo.ListWithContent(c.Request.Context(), vid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	type hit struct {
		Path  string `json:"path"`
		Snippet string `json:"snippet"`
	}
	hits := make([]hit, 0)
	lq := strings.ToLower(q)
	for _, n := range notes {
		if strings.Contains(strings.ToLower(n.Path), lq) || strings.Contains(strings.ToLower(n.Content), lq) {
			snippet := n.Content
			idx := strings.Index(strings.ToLower(snippet), lq)
			if idx > 40 {
				snippet = "…" + snippet[idx-40:]
			}
			if len(snippet) > 200 {
				snippet = snippet[:200] + "…"
			}
			hits = append(hits, hit{Path: n.Path, Snippet: snippet})
			if len(hits) >= 50 {
				break
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": hits, "total": len(hits), "q": q})
}
