package webapi

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"

	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
)

// shareTokenRe 合法分享 token 形状：8 位无歧义字符集。
// 不匹配的一律 400——否则空/畸形 token 会落进 SPA 回退返回 index.html，
// 前端 fetch 解析 JSON 失败，报错信息误导排查方向。
var shareTokenRe = regexp.MustCompile(`^[23456789abcdefghjkmnpqrstuvwxyz]{8}$`)

func validShareToken(token string) bool {
	return shareTokenRe.MatchString(token)
}

// RegisterShareRoutes 文章对外分享：
//   - 管理端（需登录）：GET/PUT /api/files/:id/share 开关与状态
//   - 公开端（免登录）：GET /api/share/:token 分享页数据
//     （页面本身是 SPA 路由 /share/:token，数据走这里）
func RegisterShareRoutes(api *gin.RouterGroup, r *gin.Engine, repo *repository.NoteRepo, shareRepo *repository.ShareRepo, attach *repository.AttachStore) {

	// ---------- 管理端：当前笔记的分享状态 ----------

	api.GET("/files/:id/share", func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		note, err := repo.GetByID(c.Request.Context(), 0, id, true)
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		s, err := shareRepo.GetOrCreateByNoteID(c.Request.Context(), note.VaultID, note.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"enabled":   s.Enabled,
			"token":     s.Token,
			"createdAt": s.CreatedAt,
		})
	})

	// 管理端：开关分享（body: {"enabled": true/false}）
	api.PUT("/files/:id/share", func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		note, err := repo.GetByID(c.Request.Context(), 0, id, true)
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// 先确保记录存在（首开时生成 token），再切换状态
		if _, err := shareRepo.GetOrCreateByNoteID(c.Request.Context(), note.VaultID, note.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		s, err := shareRepo.SetEnabled(c.Request.Context(), note.ID, body.Enabled)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		log.Printf("[web] share note=%d vault=%d enabled=%v token=%s", note.ID, note.VaultID, s.Enabled, s.Token)
		c.JSON(http.StatusOK, gin.H{"enabled": s.Enabled, "token": s.Token})
	})

	// ---------- 公开端：分享页数据（免登录） ----------

	// 分享页需要的最小元信息 + 正文（与登录态 FileDetail 同构，前端复用渲染组件）
	r.GET("/api/share/:token", func(c *gin.Context) {
		if !validShareToken(c.Param("token")) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid share token"})
			return
		}
		s, err := shareRepo.GetByToken(c.Request.Context(), c.Param("token"))
		if errors.Is(err, repository.ErrShareNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "分享不存在或已关闭"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		note, err := repo.GetByID(c.Request.Context(), s.VaultID, s.NoteID, false)
		if errors.Is(err, repository.ErrNotFound) {
			// 笔记已被删除：分享记录残留在打开状态，视为失效
			c.JSON(http.StatusNotFound, gin.H{"error": "分享不存在或已关闭"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{
			"id":          note.ID,
			"vaultId":     note.VaultID,
			"path":        note.Path,
			"content":     note.Content,
			"contentHash": note.ContentHash,
			"mtime":       note.Mtime,
			"size":        note.Size,
			"updatedAt":   note.UpdatedAt,
		})
	})

	// 公开端：分享页附件（图片等）。
	// 与登录态附件接口的差别只有鉴权——这里凭 share token + 笔记确实引用该附件放行，
	// 沿用 notes 表登记制（不开放任意路径读取）。
	r.GET("/api/share/:token/attachments/*path", func(c *gin.Context) {
		if !validShareToken(c.Param("token")) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid share token"})
			return
		}
		s, err := shareRepo.GetByToken(c.Request.Context(), c.Param("token"))
		if errors.Is(err, repository.ErrShareNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		attachPath := c.Param("path")[1:] // 去掉前导 /
		if attachPath == "" || !repository.IsAttachment(attachPath) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid attachment path"})
			return
		}
		// 必须在 notes 表里有记录（防任意文件读取），且属于分享笔记所在 vault
		if _, err := repo.GetByPath(c.Request.Context(), s.VaultID, attachPath); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		data, err := attach.LoadBytes(s.VaultID, attachPath)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "attachment data missing"})
			return
		}
		c.Header("Cache-Control", "private, max-age=86400")
		c.Data(http.StatusOK, repository.ContentType(attachPath), data)
	})
}
