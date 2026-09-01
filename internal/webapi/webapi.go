package webapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"owiki/internal/hub"
	"owiki/internal/proto"
	"owiki/internal/repository"
	"owiki/internal/service"

	"github.com/gin-gonic/gin"
)

// Register 兼容旧的全局 /api/files（跨 vault，按 id 操作并标注 vaultId）。
// 新代码请用 /api/vaults/:vid/files（vault_api.go）。
// api 传入的是已挂登录中间件的 /api 组。
func Register(api *gin.RouterGroup, repo *repository.NoteRepo, h *hub.Hub, syncLog *repository.SyncLogRepo) {

	api.GET("/files", func(c *gin.Context) {
		notes, err := repo.ListAll(c.Request.Context(), 0, true)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": notes, "total": len(notes)})
	})

	api.GET("/files/:id", func(c *gin.Context) {
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
		c.JSON(http.StatusOK, note)
	})

	api.PUT("/files/:id", func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		exist, err := repo.GetByID(c.Request.Context(), 0, id, true)
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var body struct {
			Content  string `json:"content"`
			BaseHash string `json:"baseHash"`
			Force    bool   `json:"force"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		res, err := service.Save(c.Request.Context(), repo, service.SaveInput{
			VaultID:  exist.VaultID,
			Path:     exist.Path,
			Content:  body.Content,
			Mtime:    time.Now().Unix(),
			BaseHash: body.BaseHash,
			Force:    body.Force,
		})
		if err != nil {
			var ce *service.ConflictError
			if errors.As(err, &ce) {
				c.JSON(http.StatusConflict, gin.H{
					"error":         "conflict",
					"path":          exist.Path,
					"serverHash":    ce.Server.ContentHash,
					"serverContent": ce.Server.Content,
					"mergedHint":    ce.Hint,
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if h != nil {
			msg, _ := json.Marshal(proto.Changed{Type: "changed", Path: res.Note.Path, Hash: res.Note.ContentHash})
			h.BroadcastVault(res.Note.VaultID, msg, nil)
		}
		// Web 端编辑留痕：网页里改了笔记也要出现在同步日志时间线
		if syncLog != nil {
			action := repository.ActionFileUpdate
			if res.Created {
				action = repository.ActionFileCreate
			}
			syncLog.Record(c.Request.Context(), exist.VaultID, action, exist.Path, "Web 端编辑", repository.SourceWeb, "", "Web 管理端", int64(len(res.Note.Content)))
		}
		c.JSON(http.StatusOK, gin.H{"data": res.Note, "merged": res.Merged})
	})
}
