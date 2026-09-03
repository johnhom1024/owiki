package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"owiki/internal/events"
	"owiki/internal/hub"
	owikimcp "owiki/internal/mcp"
	"owiki/internal/openapi"
	"owiki/internal/repository"
	"owiki/internal/webapi"
	"owiki/internal/ws"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// 把编译好的前端嵌进二进制：web/dist 是构建产物目录
//
//go:embed web/dist/*
var webFS embed.FS

// version 由 Makefile/CI 通过 -ldflags "-X main.version=..." 注入。
// 未注入时为 "dev"（本地开发）。该字符串会通过 /api/health 暴露，
// 并随 welcome.serverVersion 发给客户端。
var version = "dev"

func main() {
	// 本地开发便利：若存在 .env 则加载（不覆盖已设置的系统环境变量；生产容器里通常没有此文件）
	_ = godotenv.Load()

	dbPath := envOr("OWIKI_DB", "owiki.db")
	token := envOr("OWIKI_TOKEN", "dev-token-change-me")
	addr := envOr("OWIKI_ADDR", ":8787")

	// 把编译时注入的版本号同步给 ws 包（welcome 消息会用）
	ws.ServerVersion = version
	log.Printf("owiki version=%s", version)

	repo, err := repository.NewNoteRepo(dbPath)
	if err != nil {
		log.Fatalf("init db: %v", err)
	}
	// 附件（图片等二进制）存 DB 同目录 attachments/，元数据仍在 notes 表
	attachRoot := envOr("OWIKI_ATTACH_DIR", filepath.Join(filepath.Dir(dbPath), "attachments"))
	attachStore, err := repository.NewAttachStore(attachRoot)
	if err != nil {
		log.Fatalf("init attachment store: %v", err)
	}
	vaultRepo, err := repository.NewVaultRepo(repo.DB())
	if err != nil {
		log.Fatalf("init vault db: %v", err)
	}
	deviceRepo, err := repository.NewDeviceRepo(repo.DB())
	if err != nil {
		log.Fatalf("init device db: %v", err)
	}
	apiKeyRepo, err := repository.NewApiKeyRepo(repo.DB())
	if err != nil {
		log.Fatalf("init apikey db: %v", err)
	}
	adminRepo, err := repository.NewAdminUserRepo(repo.DB())
	if err != nil {
		log.Fatalf("init admin user db: %v", err)
	}
	// 同步日志（vault 设置页「同步日志」时间线的数据源）
	syncLogRepo, err := repository.NewSyncLogRepo(repo.DB())
	if err != nil {
		log.Fatalf("init sync log db: %v", err)
	}
	// 笔记分享（文章详情页分享按钮 + /share/:token 公开页）
	shareRepo, err := repository.NewShareRepo(repo.DB())
	if err != nil {
		log.Fatalf("init share db: %v", err)
	}
	// 后台定时清理过期/超量日志（30 天 + 单 vault 5000 条，每天一轮）
	syncLogRepo.StartCleanupLoop(context.Background())
	// 首次启动用环境变量初始化管理员（已存在则忽略）
	if err := adminRepo.EnsureAdmin(context.Background(),
		envOr("OWIKI_ADMIN_USER", "admin"),
		envOr("OWIKI_ADMIN_PASSWORD", "")); err != nil {
		log.Fatalf("ensure admin: %v", err)
	}
	if !adminRepo.HasUser(context.Background()) {
		log.Printf("WARNING: no admin user. Set OWIKI_ADMIN_USER/OWIKI_ADMIN_PASSWORD and restart to initialize login.")
	}

	// 旧库迁移：只有存在 vault_id=0 的遗留笔记时才建 default vault 把它们收进去。
	// 全新空库不再自动建 vault，由用户在 Web 端自己新建。
	if _, err := vaultRepo.MigrateOrphanNotes(context.Background(), token); err != nil {
		log.Fatalf("migrate orphan notes: %v", err)
	}

	h := hub.New()
	eventHub := events.NewHub()
	wsServer := ws.NewServer(h, repo, vaultRepo, deviceRepo, eventHub, attachStore, syncLogRepo, shareRepo)

	r := gin.Default()

	// health 公开（只暴露连接数与版本，登录页检查服务状态用）
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"clients": h.Count(),
			"version": version,
		})
	})

	// 登录/登出/TOTP 二次认证（无需登录的部分）
	webapi.RegisterAuthRoutes(r, adminRepo)

	// 受保护的 /api 组：除 /api/health 与 /api/auth/* 外全部需要登录
	apiGroup := r.Group("/api")
	apiGroup.Use(webapi.AdminAuthMiddleware(adminRepo))
	webapi.RegisterTotpAdminRoutes(apiGroup, adminRepo)
	webapi.Register(apiGroup, repo, h, syncLogRepo)
	webapi.RegisterVaultRoutes(apiGroup, vaultRepo, repo, deviceRepo, h, eventHub, attachStore, syncLogRepo, shareRepo)
	openapi.Register(r, repo, vaultRepo, apiKeyRepo, attachStore, h, apiGroup, syncLogRepo, shareRepo)
	// MCP：与 /openapi 共用同一套 API key；OWIKI_MCP=off 可关
	if os.Getenv("OWIKI_MCP") != "off" {
		owikimcp.New(repo, vaultRepo, apiKeyRepo, attachStore, deviceRepo, h, syncLogRepo, shareRepo, version).Register(r)
	}
	// 分享：管理端走 apiGroup（需登录），公开端直接挂 r（免登录）
	webapi.RegisterShareRoutes(apiGroup, r, repo, shareRepo, attachStore)

	// WebSocket 同步端点
	r.GET("/ws", func(c *gin.Context) {
		wsServer.Handle(c.Writer, c.Request)
	})

	// 嵌入的 Web 前端（SPA：非 API/WS 路径全回退到 index.html）
	dist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatalf("web embed: %v", err)
	}
	fileServer := http.FileServer(http.FS(dist))
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path != "/" {
			// 静态资源存在则直接服务
			if f, err := dist.Open(path[1:]); err == nil {
				f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			// SPA 回退：前端路由（/files/123 等）交给 index.html
			c.Request.URL.Path = "/"
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	})

	log.Printf("owiki listening on %s (db=%s)", addr, dbPath)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
