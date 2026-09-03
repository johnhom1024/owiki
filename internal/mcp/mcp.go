// Package mcp 内嵌 MCP（Model Context Protocol）server：让任何 MCP 客户端
// （Claude Desktop / Cursor / Claude Code 等）直接管理 Obsidian 笔记库。
//
// 设计原则：
//   - 挂载在 /mcp，与 /openapi 共用同一套 owk_ API key 认证（X-API-Key /
//     Authorization: Bearer / ?key= 查询参数三种取法）
//   - 工具直调 repo / service 层（与 openapi handler 同层），不走 HTTP 自调用
//   - readOnly key 只挂只读工具：auth 按 key 的 ReadOnly 位选 server 变体
//   - 写路径复用 openapi 包的共享 helper（Save + sync_log 留痕 + WS 广播）
//   - sync_log 来源记 "mcp"，Web 端日志时间线可看到 AI 操作痕迹
package mcp

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"owiki/internal/hub"
	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Server MCP server 装配器：按 key 权限生成对应的 *mcp.Server 变体。
type Server struct {
	repo      *repository.NoteRepo
	vaultRepo *repository.VaultRepo
	keys      *repository.ApiKeyRepo
	attach    *repository.AttachStore
	devices   *repository.DeviceRepo
	hub       *hub.Hub
	syncLog   *repository.SyncLogRepo
	share     *repository.ShareRepo
	version   string

	// 两种工具集的 server 变体（懒初始化）：full 挂全部工具，
	// readOnly 只挂只读工具。共享同一个 deps。
	full     *mcp.Server
	readOnly *mcp.Server
}

// New 装配 MCP server（不挂路由；Register 时才挂）。
func New(repo *repository.NoteRepo, vaultRepo *repository.VaultRepo, keys *repository.ApiKeyRepo,
	attach *repository.AttachStore, devices *repository.DeviceRepo, h *hub.Hub,
	syncLog *repository.SyncLogRepo, share *repository.ShareRepo, version string) *Server {
	return &Server{
		repo: repo, vaultRepo: vaultRepo, keys: keys, attach: attach,
		devices: devices, hub: h, syncLog: syncLog, share: share, version: version,
	}
}

// Register 把 /mcp 挂到 gin 引擎上。
// 环境变量 OWIKI_MCP=off 可整体关闭。
func (s *Server) Register(r *gin.Engine) {
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		// auth 中间件已校验 key 并把所选变体挂到 request context。
		// go-sdk 的 getServer 回调拿不到 gin context，这里通过
		// request 上的自定义属性传递（见 authMiddleware）。
		if v, ok := r.Context().Value(serverVariantKey{}).(*mcp.Server); ok && v != nil {
			return v
		}
		// 无 key 信息的请求（auth 中间件未跑或放行了空 key）：拒绝
		return nil
	}, &mcp.StreamableHTTPOptions{
		// 无状态模式：每次请求独立会话，天然适配「按请求选工具集」的设计
		Stateless: true,
	})

	g := r.Group("/mcp")
	g.Use(s.authMiddleware())
	g.Any("/*any", gin.WrapH(handler))
}

// serverVariantKey request context key 类型（避免与其他包冲突）
type serverVariantKey struct{}

// authMiddleware 校验 API key 并把对应工具集的 server 变体放进 request context。
// key 取法（优先级）：X-API-Key 头 > Authorization: Bearer > ?key= 查询参数。
func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("X-API-Key")
		if key == "" {
			auth := c.GetHeader("Authorization")
			if after, ok := strings.CutPrefix(auth, "Bearer "); ok {
				key = after
			}
		}
		if key == "" {
			key = c.Query("key")
			if key != "" {
				// 把查询参数注入 header，让 MCP handler 通过 Extra.Header 也能读到
				c.Request.Header.Set("X-API-Key", key)
			}
		}
		if key == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing API key (X-API-Key header, Bearer, or ?key=)"})
			return
		}
		k, ok := s.keys.Verify(c.Request.Context(), key)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid api key"})
			return
		}
		var variant *mcp.Server
		if k.ReadOnly {
			variant = s.readOnlyServer()
		} else {
			variant = s.fullServer()
		}
		ctx := context.WithValue(c.Request.Context(), serverVariantKey{}, variant)
		c.Request = c.Request.WithContext(ctx)
		s.keys.TouchKey(c.Request.Context(), k.ID)
		// variant 同时存 gin context，供日志等场景使用
		c.Set("mcpServer", variant)
		c.Set("apiKey", k)
		c.Next()
	}
}

// fullServer 全量工具集（读 + 写）。
func (s *Server) fullServer() *mcp.Server {
	if s.full != nil {
		return s.full
	}
	srv := mcp.NewServer(&mcp.Implementation{Name: "owiki", Version: s.version}, nil)
	s.registerReadTools(srv)
	s.registerWriteTools(srv)
	s.registerGraphTools(srv)
	s.registerSystemReadTools(srv)
	s.registerSystemWriteTools(srv)
	s.full = srv
	return srv
}

// readOnlyServer 只读工具集：读 + 图结构 + 系统信息（不含任何写操作）。
func (s *Server) readOnlyServer() *mcp.Server {
	if s.readOnly != nil {
		return s.readOnly
	}
	srv := mcp.NewServer(&mcp.Implementation{Name: "owiki", Version: s.version}, nil)
	s.registerReadTools(srv)
	s.registerGraphTools(srv)
	s.registerSystemReadTools(srv)
	s.readOnly = srv
	return srv
}

// resolveVault 把 vault 参数（id 或 name）解析成 vault id，并校验 key 作用域。
// vault 为空时：key 限定了 vault → 用该 vault；否则若服务器只有一个 vault 则默认它；
// 多个 vault 时强制要求指定。
func (s *Server) resolveVault(k *model.ApiKey, vault string) (int64, *model.Vault, error) {
	if k.VaultScope != 0 && vault == "" {
		v, err := s.vaultRepo.GetByID(context.Background(), k.VaultScope)
		if err != nil {
			return 0, nil, err
		}
		return v.ID, v, nil
	}
	if vault == "" {
		vaults, err := s.vaultRepo.List(context.Background())
		if err != nil {
			return 0, nil, err
		}
		// 过滤出 key 允许的 vault
		var allowed []model.Vault
		for _, v := range vaults {
			if k.VaultScope == 0 || k.VaultScope == v.ID {
				allowed = append(allowed, v)
			}
		}
		if len(allowed) == 1 {
			return allowed[0].ID, &allowed[0], nil
		}
		if len(allowed) == 0 {
			return 0, nil, errVaultNotFound
		}
		return 0, nil, errors.New("vault required: pass vault id or name (multiple vaults exist)")
	}
	// 先按 id 试
	if id, err := strconv.ParseInt(vault, 10, 64); err == nil {
		v, err := s.vaultRepo.GetByID(context.Background(), id)
		if err == nil {
			if k.VaultScope != 0 && k.VaultScope != v.ID {
				return 0, nil, errScope
			}
			return v.ID, v, nil
		}
	}
	// 按名称查
	vaults, err := s.vaultRepo.List(context.Background())
	if err != nil {
		return 0, nil, err
	}
	for _, v := range vaults {
		if v.Name == vault {
			if k.VaultScope != 0 && k.VaultScope != v.ID {
				return 0, nil, errScope
			}
			return v.ID, &v, nil
		}
	}
	return 0, nil, errVaultNotFound
}

var (
	errScope       = errors.New("vault not in key scope")
	errVaultNotFound = errors.New("vault not found")
)
