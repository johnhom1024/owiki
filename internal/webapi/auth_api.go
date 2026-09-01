package webapi

import (
	"errors"
	"net/http"

	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
)

const sessionCookie = "owiki_session"

// RegisterAuthRoutes 登录/登出/TOTP 二次认证。
// 放在受保护的 /api 组之外注册（main.go 中先注册这组，再给 /api 组挂中间件）。
func RegisterAuthRoutes(r *gin.Engine, adminRepo *repository.AdminUserRepo) {
	auth := r.Group("/api/auth")
	limiter := newLoginLimiter()

	// 登录页需要知道是否已初始化管理员，此端点不要求登录
	auth.GET("/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"initialized": adminRepo.HasUser(c.Request.Context()),
		})
	})

	// 第一步：用户名+密码。启用 TOTP 时不发 session，返回短时票据。
	auth.POST("/login", limiter.wrapLogin(func(c *gin.Context) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
			return
		}
		ip, _ := c.Get("clientIP")
		ipStr, _ := ip.(string)
		result, err := adminRepo.Login(c.Request.Context(), body.Username, body.Password)
		if err != nil {
			// 密码正确但启用了 TOTP：进入第二步
			if errors.Is(err, repository.ErrTotpRequired) {
				c.JSON(http.StatusOK, gin.H{"needTotp": true, "totpTicket": result})
				return
			}
			limiter.recordFailure(ipStr, body.Username)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
			return
		}
		limiter.recordSuccess(ipStr)
		c.SetCookie(sessionCookie, result, 7*24*3600, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}))

	// 第二步：票据 + 6 位验证码 → session（同样受限速保护）
	auth.POST("/totp", limiter.wrapLogin(func(c *gin.Context) {
		var body struct {
			TotpTicket string `json:"totpTicket"`
			Code       string `json:"code"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
			return
		}
		ip, _ := c.Get("clientIP")
		ipStr, _ := ip.(string)
		token, err := adminRepo.LoginTotp(c.Request.Context(), body.TotpTicket, body.Code)
		if err != nil {
			limiter.recordFailure(ipStr, "(totp)")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "验证码错误或已过期"})
			return
		}
		limiter.recordSuccess(ipStr)
		c.SetCookie(sessionCookie, token, 7*24*3600, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}))

	auth.POST("/logout", func(c *gin.Context) {
		token, _ := c.Cookie(sessionCookie)
		adminRepo.Logout(c.Request.Context(), token)
		c.SetCookie(sessionCookie, "", -1, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

// RegisterTotpAdminRoutes TOTP 管理（需登录）：状态/开始设置/确认/关闭。
func RegisterTotpAdminRoutes(api *gin.RouterGroup, adminRepo *repository.AdminUserRepo) {
	t := api.Group("/auth/totp")

	// 当前状态
	t.GET("", func(c *gin.Context) {
		enabled, pending, err := adminRepo.GetTotpStatus(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"enabled": enabled, "pending": pending})
	})

	// 开始设置：生成 secret + otpauth URL（前端渲染二维码）
	t.POST("/setup", func(c *gin.Context) {
		secret, url, err := adminRepo.BeginTotpSetup(c.Request.Context(), "OWiki")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"secret": secret, "otpauthUrl": url})
	})

	// 确认开启：扫码后输入一次验证码
	t.POST("/confirm", func(c *gin.Context) {
		var body struct {
			Code string `json:"code"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "code required"})
			return
		}
		if err := adminRepo.ConfirmTotpSetup(c.Request.Context(), body.Code); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "验证码错误，请重试"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// 关闭：需要密码复核
	t.POST("/disable", func(c *gin.Context) {
		var body struct {
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Password == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
			return
		}
		if !adminRepo.VerifyPassword(c.Request.Context(), body.Password) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "密码错误"})
			return
		}
		if err := adminRepo.DisableTotp(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

// AdminAuthMiddleware 校验 session cookie；未登录 401（前端据此跳登录页）。
// /api/auth/* 与 /api/health 豁免（在 main.go 里分组处理）。
func AdminAuthMiddleware(adminRepo *repository.AdminUserRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, _ := c.Cookie(sessionCookie)
		if _, ok := adminRepo.VerifySession(c.Request.Context(), token); ok {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	}
}
