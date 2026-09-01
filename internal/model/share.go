package model

import "time"

// Share 单篇笔记的对外分享记录：一条 note 最多一条（note_id 唯一索引）。
// Token 是分享 URL 里的随机串；Enabled=false 后链接立即失效。
// 记录本身保留——关掉再开，URL 不变。
type Share struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	VaultID   int64     `gorm:"not null;index" json:"vaultId"`
	NoteID    int64     `gorm:"not null;uniqueIndex:idx_share_note" json:"noteId"`
	Token     string    `gorm:"type:varchar(16);uniqueIndex;not null" json:"token"`
	Enabled   bool      `gorm:"not null;default:false" json:"enabled"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}
