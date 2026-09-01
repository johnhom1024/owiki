package repository

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"owiki/internal/model"

	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var ErrBadCredentials = errors.New("bad credentials")
var ErrTotpRequired = errors.New("totp required")
var ErrTotpPendingRequired = errors.New("totp pending confirmation required")

// totpTickets 二次认证第一步（密码正确）签发的短时票据，内存存储。
type totpTickets struct {
	mu sync.Mutex
	m  map[string]totpTicketEntry
}

type totpTicketEntry struct {
	userID  int64
	expires time.Time
}

// AdminUserRepo 管理员账户 + 会话存储。
type AdminUserRepo struct {
	db          *gorm.DB
	totpTickets totpTickets
}

func NewAdminUserRepo(db *gorm.DB) (*AdminUserRepo, error) {
	if err := db.AutoMigrate(&model.AdminUser{}, &model.AdminSession{}); err != nil {
		return nil, err
	}
	return &AdminUserRepo{db: db, totpTickets: totpTickets{m: make(map[string]totpTicketEntry)}}, nil
}

// EnsureAdmin 确保存在管理员：无任何用户时用给定用户名/密码创建。
// 已存在则不动（环境变量改密码只影响新建，不覆盖既有账户）。
func (r *AdminUserRepo) EnsureAdmin(ctx context.Context, username, password string) error {
	var n int64
	if err := r.db.WithContext(ctx).Model(&model.AdminUser{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if username == "" || password == "" {
		return nil // 不强制创建；登录页会提示未初始化
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Create(&model.AdminUser{Username: username, PasswordHash: string(hash)}).Error
}

// HasUser 是否已初始化管理员（登录页据此展示不同提示）
func (r *AdminUserRepo) HasUser(ctx context.Context) bool {
	var n int64
	_ = r.db.WithContext(ctx).Model(&model.AdminUser{}).Count(&n).Error
	return n > 0
}

// Login 校验用户名+密码：
//   - 未启用 TOTP：直接建会话，返回 (token, nil)
//   - 已启用 TOTP：不建会话，返回 5 分钟有效的临时票据 + ErrTotpRequired，
//     票据用于第二步提交验证码换取真 session。
func (r *AdminUserRepo) Login(ctx context.Context, username, password string) (string, error) {
	var u model.AdminUser
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&u).Error
	if err != nil {
		// 用户不存在也走一次 bcrypt 比对，避免时序侧探用户名
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5B0C4rP7dyNzXhbbXVEXAMPLE"), []byte(password))
		return "", ErrBadCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return "", ErrBadCredentials
	}

	// 启用了 TOTP：密码对也不发 session，签发短时票据
	if u.TOTPSecret != "" {
		ticket := newRandomToken()
		r.totpTickets.mu.Lock()
		r.totpTickets.m[ticket] = totpTicketEntry{userID: u.ID, expires: time.Now().Add(5 * time.Minute)}
		// 顺手清理过期票据
		for k, v := range r.totpTickets.m {
			if time.Now().After(v.expires) {
				delete(r.totpTickets.m, k)
			}
		}
		r.totpTickets.mu.Unlock()
		return ticket, ErrTotpRequired
	}
	return r.createSession(ctx, u.ID)
}

// LoginTotp 二次认证第二步：票据 + 6 位验证码 → 真 session。
func (r *AdminUserRepo) LoginTotp(ctx context.Context, ticket, code string) (string, error) {
	r.totpTickets.mu.Lock()
	entry, ok := r.totpTickets.m[ticket]
	if ok && time.Now().After(entry.expires) {
		delete(r.totpTickets.m, ticket)
		ok = false
	}
	r.totpTickets.mu.Unlock()
	if !ok {
		return "", ErrBadCredentials
	}

	var u model.AdminUser
	if err := r.db.WithContext(ctx).First(&u, entry.userID).Error; err != nil {
		return "", ErrBadCredentials
	}
	if u.TOTPSecret == "" {
		return "", ErrBadCredentials
	}
	slice, err := verifyTotp(u.TOTPSecret, code, u.LastTotpSlice)
	if err != nil {
		return "", ErrBadCredentials
	}
	// 记录时间片防重放，并作废票据
	if err := r.db.WithContext(ctx).Model(&model.AdminUser{}).Where("id = ?", u.ID).
		Update("last_totp_slice", slice).Error; err != nil {
		return "", err
	}
	r.totpTickets.mu.Lock()
	delete(r.totpTickets.m, ticket)
	r.totpTickets.mu.Unlock()
	return r.createSession(ctx, u.ID)
}

func (r *AdminUserRepo) createSession(ctx context.Context, userID int64) (string, error) {
	sess := model.AdminSession{
		Token:     newRandomToken(),
		UserID:    userID,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	if err := r.db.WithContext(ctx).Create(&sess).Error; err != nil {
		return "", err
	}
	// 顺手清理过期会话（失败不影响登录）
	_ = r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&model.AdminSession{}).Error
	return sess.Token, nil
}

func newRandomToken() string {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

// VerifySession cookie token → (userID, ok)。过期/不存在均 false。
func (r *AdminUserRepo) VerifySession(ctx context.Context, token string) (int64, bool) {
	if token == "" {
		return 0, false
	}
	var s model.AdminSession
	err := r.db.WithContext(ctx).Where("token = ?", token).First(&s).Error
	if err != nil || time.Now().After(s.ExpiresAt) {
		return 0, false
	}
	return s.UserID, true
}

// Logout 删除会话。
func (r *AdminUserRepo) Logout(ctx context.Context, token string) {
	if token != "" {
		_ = r.db.WithContext(ctx).Delete(&model.AdminSession{}, "token = ?", token).Error
	}
}

// ---------- TOTP 管理（登录后设置/关闭） ----------

// GetTotpStatus 当前启用状态 + 是否有待确认的 pending secret
func (r *AdminUserRepo) GetTotpStatus(ctx context.Context) (enabled bool, pending bool, err error) {
	var u model.AdminUser
	if err = r.db.WithContext(ctx).First(&u).Error; err != nil {
		return
	}
	return u.TOTPSecret != "", u.TotpPending != "", nil
}

// BeginTotpSetup 生成新 secret（存 pending，等待用户扫码后确认）。
// 返回 secret 明文与 otpauth:// URL，前端渲染成二维码。
func (r *AdminUserRepo) BeginTotpSetup(ctx context.Context, issuer string) (secret, url string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{Issuer: issuer, AccountName: "owiki-admin"})
	if err != nil {
		return
	}
	err = r.db.WithContext(ctx).Model(&model.AdminUser{}).Where("1=1").
		Update("totp_pending", key.Secret()).Error
	return key.Secret(), key.URL(), err
}

// ConfirmTotpSetup 用户扫码后输入验证码确认：pending → 正式启用。
func (r *AdminUserRepo) ConfirmTotpSetup(ctx context.Context, code string) error {
	var u model.AdminUser
	if err := r.db.WithContext(ctx).First(&u).Error; err != nil {
		return err
	}
	if u.TotpPending == "" {
		return ErrTotpPendingRequired
	}
	slice, err := verifyTotp(u.TotpPending, code, 0)
	if err != nil {
		return ErrBadCredentials
	}
	return r.db.WithContext(ctx).Model(&model.AdminUser{}).Where("id = ?", u.ID).
		Updates(map[string]any{"totp_secret": u.TotpPending, "totp_pending": "", "last_totp_slice": slice}).Error
}

// DisableTotp 关闭二次认证（密码复核由 handler 层做）
func (r *AdminUserRepo) DisableTotp(ctx context.Context) error {
	return r.db.WithContext(ctx).Model(&model.AdminUser{}).Where("1=1").
		Updates(map[string]any{"totp_secret": "", "totp_pending": "", "last_totp_slice": 0}).Error
}

// VerifyPassword 供敏感操作（关 TOTP）复核密码
func (r *AdminUserRepo) VerifyPassword(ctx context.Context, password string) bool {
	var u model.AdminUser
	if r.db.WithContext(ctx).First(&u).Error != nil {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

// verifyTotp 校验 6 位码（允许 ±1 个 30s 窗口），成功返回所用时间片号。
func verifyTotp(secret, code string, lastSlice int64) (int64, error) {
	now := time.Now().Unix()
	currentSlice := now / 30
	// 尝试 [当前-1, 当前+1] 共 3 个窗口，优先命中最新时间片
	for offset := int64(1); offset >= -1; offset-- {
		slice := currentSlice + offset
		if slice <= lastSlice {
			continue // 已用过的时间片（重放）
		}
		// 生成该时间片的期望码比对
		expect, err := totp.GenerateCodeCustom(secret, time.Unix(slice*30, 0), totp.ValidateOpts{
			Period: 30, Skew: 0, Digits: 6,
		})
		if err != nil {
			return 0, err
		}
		if expect == code {
			return slice, nil
		}
	}
	return 0, errors.New("totp code invalid")
}
