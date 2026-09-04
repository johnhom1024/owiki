package webapi

import (
	"log"
	"net/http"

	"owiki/internal/events"
	"owiki/internal/feature"
	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
)

// RegisterFeatureAPI 挂 /api/features 管理端点（需登录）：
//   - GET /api/features        全部功能及开关状态（前端 registry 数据源）
//   - PUT /api/features/:id    切换开关（body: {"enabled": bool}）
//
// PUT 成功后：更新内存 registry + 持久化 settings 表 + SSE 广播
// feature.changed（所有在线标签页/设备同步收到，前端立即重算 UI）。
func RegisterFeatureAPI(api *gin.RouterGroup, settingRepo *repository.SettingRepo, eventHub *events.Hub) {
	api.GET("/features", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": feature.Use().List()})
	})

	api.PUT("/features/:id", func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// canToggle=false 的核心功能：注册表直接拒绝
		if !feature.Use().SetEnabled(id, body.Enabled) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "feature not toggleable: " + id})
			return
		}
		// 持久化（失败则回滚内存状态，避免 DB 与内存漂移）
		if err := settingRepo.Set(c.Request.Context(), feature.SettingKey(id), boolStr(body.Enabled)); err != nil {
			feature.Use().SetEnabled(id, !body.Enabled) // 回滚
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if eventHub != nil {
			eventHub.Publish(events.Event{Type: "feature.changed", Path: id})
		}
		log.Printf("[web] feature %s enabled=%v", id, body.Enabled)
		c.JSON(http.StatusOK, gin.H{"data": feature.Use().List()})
	})
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
