package model

import "time"

// Note 笔记/文件记录（Markdown 或任何文本文件）
type Note struct {
	ID int64 `gorm:"primaryKey;autoIncrement" json:"id"`
	// VaultID 所属 vault；0 仅存在于旧数据迁移前的瞬间
	VaultID     int64  `gorm:"uniqueIndex:idx_path_per_vault;not null;default:0" json:"vaultId"`
	Path        string `gorm:"type:varchar(1024);uniqueIndex:idx_path_per_vault;not null" json:"path"`
	Content     string `gorm:"type:text" json:"content"`
	ContentHash string `gorm:"type:varchar(64);index" json:"contentHash"`
	// Snapshot 是上次成功写入后双方共同承认的祖先，三方合并的 base。
	Snapshot     string `gorm:"type:text" json:"snapshot"`
	SnapshotHash string `gorm:"type:varchar(64)" json:"snapshotHash"`
	Mtime        int64  `json:"mtime"`
	Size         int64  `json:"size"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}
