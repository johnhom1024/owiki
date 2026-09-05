package webapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"owiki/internal/events"
	"owiki/internal/feature"
	"owiki/internal/gitbackup"
	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
)

// RegisterGitBackupRoutes vault 级 git 备份配置 + 手动触发（需登录）。
// 路由组整体挂 feature.Require("gitbackup")：总开关关闭时全部 404。
//
//	GET  /api/vaults/:vid/git-backup        查配置+状态（token 掩码）
//	PUT  /api/vaults/:vid/git-backup        保存配置；enabled 从 false→true 时起 worker
//	POST /api/vaults/:vid/git-backup/run    立即备份一轮（跳过防抖）
func RegisterGitBackupRoutes(api *gin.RouterGroup, gbRepo *repository.GitBackupRepo, mgr *gitbackup.Manager, vaultRepo *repository.VaultRepo, eventHub *events.Hub) {
	g := api.Group("/vaults/:vid/git-backup", feature.Require(gitbackup.FeatureID))

	// vault 存在性校验（与 vault_api 的 vg 组一致）
	g.Use(func(c *gin.Context) {
		vid, err := strconv.ParseInt(c.Param("vid"), 10, 64)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid vault id"})
			return
		}
		if _, err := vaultRepo.GetByID(c.Request.Context(), vid); err != nil {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "vault not found"})
			return
		}
		c.Set("vid", vid)
	})

	g.GET("", func(c *gin.Context) {
		vid := c.GetInt64("vid")
		b, err := gbRepo.GetOrCreate(c.Request.Context(), vid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": toView(b)})
	})

	g.PUT("", func(c *gin.Context) {
		vid := c.GetInt64("vid")
		var body struct {
			RemoteURL   string `json:"remoteUrl"`
			Branch      string `json:"branch"`
			Token       string `json:"token"`
			DebounceSec *int   `json:"debounceSec"`
			Enabled     *bool  `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		b, err := gbRepo.GetOrCreate(c.Request.Context(), vid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 字段更新：指针/非空才覆盖（token 空串=保持不变，前端掩码不回传明文）
		if body.RemoteURL != "" {
			if err := validateRemoteURL(body.RemoteURL); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			b.RemoteURL = strings.TrimSpace(body.RemoteURL)
		}
		if body.Branch != "" {
			b.Branch = sanitizeBranch(body.Branch)
		}
		if body.Token != "" {
			b.Token = strings.TrimSpace(body.Token)
		}
		if body.DebounceSec != nil {
			if *body.DebounceSec < 5 || *body.DebounceSec > 3600 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "debounceSec must be 5-3600"})
				return
			}
			b.DebounceSec = *body.DebounceSec
		}
		wasEnabled := b.Enabled
		if body.Enabled != nil {
			b.Enabled = *body.Enabled
		}
		// 开启前的基础校验：远程 + token 必须都有（token 允许空：file:// 本地测试 remote）
		if b.Enabled && b.RemoteURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "remoteUrl required to enable"})
			return
		}

		if err := gbRepo.Save(c.Request.Context(), b); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 状态联动：开→起 worker；关→停 worker（工作树保留）
		if b.Enabled && !wasEnabled && mgr != nil {
			mgr.EnsureWorker(vid)
		} else if !b.Enabled && wasEnabled && mgr != nil {
			mgr.RemoveWorker(vid)
		}
		c.JSON(http.StatusOK, gin.H{"data": toView(b)})
	})

	g.POST("/run", func(c *gin.Context) {
		vid := c.GetInt64("vid")
		if mgr == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "gitbackup manager not running"})
			return
		}
		b, err := gbRepo.GetByVault(c.Request.Context(), vid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "git backup not enabled for this vault"})
			return
		}
		if !b.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "git backup not enabled for this vault"})
			return
		}
		mgr.RunNow(vid)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

// gitBackupView API 响应 DTO：token 只回掩码（已设置）或空串（未设置）。
type gitBackupView struct {
	VaultID       int64      `json:"vaultId"`
	RemoteURL     string     `json:"remoteUrl"`
	Branch        string     `json:"branch"`
	Token         string     `json:"token"`
	DebounceSec   int        `json:"debounceSec"`
	Enabled       bool       `json:"enabled"`
	LastCommitSHA string     `json:"lastCommitSha"`
	LastPushAt    *time.Time `json:"lastPushAt"`
	LastRunAt     *time.Time `json:"lastRunAt"`
	LastError     string     `json:"lastError"`
	Status        string     `json:"status"`
}

func toView(b *model.VaultGitBackup) gitBackupView {
	tok := ""
	if b.Token != "" {
		tok = "•••••"
	}
	return gitBackupView{
		VaultID: b.VaultID, RemoteURL: b.RemoteURL, Branch: b.Branch,
		Token: tok, DebounceSec: b.DebounceSec, Enabled: b.Enabled,
		LastCommitSHA: b.LastCommitSHA, LastPushAt: b.LastPushAt,
		LastRunAt: b.LastRunAt, LastError: b.LastError, Status: b.Status,
	}
}

// validateRemoteURL 只接受 https:// 与 file://（本地测试）。
// SSH 形态（git@）后续版本支持，先明确拒绝并提示。
func validateRemoteURL(u string) error {
	if strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "file://") || strings.HasPrefix(u, "test://") {
		return nil
	}
	if strings.Contains(u, "@") {
		return errSSHNotSupported
	}
	return errBadRemoteURL
}

var (
	errSSHNotSupported = &userError{"仅支持 https:// 远程地址（SSH 形态后续版本支持）"}
	errBadRemoteURL    = &userError{"远程地址必须是 https:// 开头"}
)

type userError struct{ msg string }

func (e *userError) Error() string { return e.msg }

// sanitizeBranch 去掉 refs/heads/ 前缀与空白。
func sanitizeBranch(b string) string {
	b = strings.TrimSpace(b)
	b = strings.TrimPrefix(b, "refs/heads/")
	return b
}
