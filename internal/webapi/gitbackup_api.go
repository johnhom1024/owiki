package webapi

import (
	"fmt"
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

// gitBackupSyncLog 恢复应用写同步日志用。SetGitBackupSyncLog 注入（可空）。
var gitBackupSyncLog *repository.SyncLogRepo

// SetGitBackupSyncLog 注入同步日志仓库（main 装配时调用）。
func SetGitBackupSyncLog(r *repository.SyncLogRepo) { gitBackupSyncLog = r }

// validRestoreRef 恢复来源 ref 白名单：目标分支名或 owiki/diverged-* 护底分支。
// 拒绝怪字符防 ref 注入。
func validRestoreRef(ref string) bool {
	if ref == "" {
		return true
	}
	if strings.HasPrefix(ref, "owiki/diverged-") {
		return len(ref) <= 64
	}
	for _, r := range ref {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '-' || r == '_' || r == '/' || r == '.') {
			return false
		}
	}
	return len(ref) <= 64
}

// sanitizeErrPublic 对外错误信息去 token（URL userinfo 形态）。
func sanitizeErrPublic(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, "://"); i >= 0 {
		rest := msg[i+3:]
		if j := strings.Index(rest, "@"); j >= 0 {
			msg = msg[:i+3] + msg[i+3+j+1:]
		}
	}
	return msg
}

// RegisterGitBackupRoutes vault 级 git 备份配置 + 手动触发（需登录）。
// 路由组整体挂 feature.Require("gitbackup")：总开关关闭时全部 404。
//
//	GET  /api/vaults/:vid/git-backup                 查配置+状态（token 掩码）
//	PUT  /api/vaults/:vid/git-backup                 保存配置；enabled 从 false→true 时起 worker
//	POST /api/vaults/:vid/git-backup/preflight       探测远程仓库状态（开启前确认用）
//	POST /api/vaults/:vid/git-backup/restore/diff    恢复预览（远程 vs DB 差异清单）
//	POST /api/vaults/:vid/git-backup/restore/apply   恢复应用（选中文件写回 DB）
//	POST /api/vaults/:vid/git-backup/run             立即备份一轮（跳过防抖）
func RegisterGitBackupRoutes(api *gin.RouterGroup, gbRepo *repository.GitBackupRepo, mgr *gitbackup.Manager, vaultRepo *repository.VaultRepo, eventHub *events.Hub, runner *gitbackup.Runner) {
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

	// 探测远程仓库状态：开启备份前给用户看「远端是什么、接上去会发生什么」。
	// body 可带 remoteUrl/token/branch 覆盖已存配置（还没保存就能先探测）。
	g.POST("/preflight", func(c *gin.Context) {
		if runner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "gitbackup runner not ready"})
			return
		}
		var body struct {
			RemoteURL string `json:"remoteUrl"`
			Token     string `json:"token"`
			Branch    string `json:"branch"`
		}
		_ = c.ShouldBindJSON(&body) // 空 body 合法：用已存配置探测

		vid := c.GetInt64("vid")
		if b, err := gbRepo.GetByVault(c.Request.Context(), vid); err == nil {
			if body.RemoteURL == "" {
				body.RemoteURL = b.RemoteURL
			}
			if body.Token == "" {
				body.Token = b.Token // 探测用已存 token（body 没带明文时）
			}
			if body.Branch == "" {
				body.Branch = b.Branch
			}
		}
		if body.RemoteURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "remoteUrl required"})
			return
		}
		if err := validateRemoteURL(body.RemoteURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res := runner.Preflight(c.Request.Context(), body.RemoteURL, body.Token, body.Branch)
		c.JSON(http.StatusOK, gin.H{"data": res})
	})

	// 恢复预览：远程（或护底分支）vs DB 的文件差异清单。
	g.POST("/restore/diff", func(c *gin.Context) {
		if runner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "gitbackup runner not ready"})
			return
		}
		var body struct {
			From string `json:"from"` // 可选：护底分支名；空 = 目标分支 HEAD
		}
		_ = c.ShouldBindJSON(&body)

		vid := c.GetInt64("vid")
		cfg, err := gbRepo.GetByVault(c.Request.Context(), vid)
		if err != nil || cfg.RemoteURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "remote not configured"})
			return
		}
		if !validRestoreRef(body.From) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ref"})
			return
		}
		diff, err := runner.RestoreDiff(c.Request.Context(), cfg, body.From)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": sanitizeErrPublic(err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": diff})
	})

	// 恢复应用：把选中的远程文件写回 DB（Force 覆盖）。
	g.POST("/restore/apply", func(c *gin.Context) {
		if runner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "gitbackup runner not ready"})
			return
		}
		var body struct {
			From  string   `json:"from"`
			Mode  string   `json:"mode"` // all | selected
			Paths []string `json:"paths"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
			return
		}
		if body.Mode != "all" && body.Mode != "selected" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be all|selected"})
			return
		}
		if body.Mode == "selected" && len(body.Paths) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "paths required for selected mode"})
			return
		}
		if !validRestoreRef(body.From) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ref"})
			return
		}

		vid := c.GetInt64("vid")
		cfg, err := gbRepo.GetByVault(c.Request.Context(), vid)
		if err != nil || cfg.RemoteURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "remote not configured"})
			return
		}
		res, err := runner.RestoreApply(c.Request.Context(), cfg, body.From, body.Mode, body.Paths)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": sanitizeErrPublic(err)})
			return
		}
		// 同步日志 + SSE 事件（前端 GitBackupCard 刷新状态）
		if gitBackupSyncLog != nil {
			gitBackupSyncLog.Record(c.Request.Context(), vid, "gitbackup.restore", "",
				fmt.Sprintf("restored %d files (ref=%s)", res.Applied, body.From), "gitbackup", "", "Git 备份", int64(res.Applied))
		}
		if eventHub != nil {
			eventHub.Publish(events.Event{Type: "vault.log", VaultID: vid})
		}
		c.JSON(http.StatusOK, gin.H{"data": res})
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
