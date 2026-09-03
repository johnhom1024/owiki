package model

import "time"

// ApiKey 开放接口密钥：给 AI/脚本调 /openapi/* 与 /mcp 用。
// KeyHash 存 SHA-256（明文只在创建时返回一次）；KeyPrefix 供列表辨识。
// VaultScope 限定 key 可访问的 vault：0 = 全部 vault。
// ReadOnly 为 true 时该 key 只能调用只读工具（MCP 侧不挂写工具）。
type ApiKey struct {
	ID        int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Name      string     `gorm:"type:varchar(255);not null" json:"name"`
	KeyHash   string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"`
	KeyPrefix string     `gorm:"type:varchar(16)" json:"keyPrefix"`
	VaultScope int64     `gorm:"not null;default:0" json:"vaultScope"`
	ReadOnly  bool       `gorm:"not null;default:false" json:"readOnly"`
	CreatedAt time.Time  `gorm:"autoCreateTime" json:"createdAt"`
	// LastUsedAt 最近一次调用时间（nil=从未）
	LastUsedAt *time.Time `gorm:"index" json:"lastUsedAt"`
}
