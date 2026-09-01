package model

import "time"

// AdminUser 管理员账户（Phase 1 单用户：不开放注册，环境变量/首启初始化）。
// PasswordHash 存 bcrypt；Username 唯一。
// TOTPSecret 非空 = 已启用二次认证；TotpPending 是"生成二维码后待确认"的中间态；
// LastTotpSlice 记录最近一次使用的 30s 时间片号，防同一验证码重放。
type AdminUser struct {
	ID            int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Username      string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"username"`
	PasswordHash  string    `gorm:"type:varchar(255);not null" json:"-"`
	TOTPSecret    string    `gorm:"type:varchar(128);not null;default:''" json:"-"`
	TotpPending   string    `gorm:"type:varchar(128);not null;default:''" json:"-"`
	LastTotpSlice int64     `gorm:"not null;default:0" json:"-"`
	CreatedAt     time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt     time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

// AdminSession 登录会话：随机 token（HttpOnly cookie）→ 服务端记录。
// 过期后由登录接口惰性清理；登出即删除。
type AdminSession struct {
	Token      string    `gorm:"primaryKey;type:varchar(64)" json:"-"`
	UserID     int64     `gorm:"index;not null" json:"userId"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"createdAt"`
	ExpiresAt  time.Time `gorm:"index;not null" json:"expiresAt"`
}
