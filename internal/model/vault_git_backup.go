package model

import "time"

// VaultGitBackup 单个 vault 的 git 远程备份配置 + 运行状态（vault_id 唯一）。
// feature 总开关在 settings 表（feature.gitbackup.enabled），本表是 vault 级配置；
// 两者同时开着才会真正跑备份。
type VaultGitBackup struct {
	ID int64 `gorm:"primaryKey;autoIncrement" json:"id"`
	// VaultID 一 vault 一条配置
	VaultID int64 `gorm:"uniqueIndex" json:"vaultId"`
	// RemoteURL https:// 形式的远程仓库地址（SSH 后续版本支持）
	RemoteURL string `gorm:"type:varchar(1024)" json:"remoteUrl"`
	// Branch 目标分支，默认 main
	Branch string `gorm:"type:varchar(128)" json:"branch"`
	// Token HTTPS PAT；API 响应只回掩码，绝不回明文
	Token string `gorm:"type:varchar(512)" json:"-"`
	// DebounceSec 防抖窗口（秒）：事件聚合后等这么多秒再跑一轮，默认 15
	DebounceSec int `json:"debounceSec"`
	// Enabled 本 vault 的备份开关（feature 总开关关闭时此项无效）
	Enabled bool `json:"enabled"`

	// ---------- 运行状态 ----------

	// LastCommitSHA 最近一次成功 commit 的短 SHA（展示用）
	LastCommitSHA string `gorm:"type:varchar(40)" json:"lastCommitSha"`
	// LastPushAt 最近一次成功 push 时间
	LastPushAt *time.Time `json:"lastPushAt"`
	// LastRunAt 最近一次尝试运行时间（无论成败）
	LastRunAt *time.Time `json:"lastRunAt"`
	// LastError 最近一次失败原因（空 = 无错误）；含 token 等敏感信息前必须脱敏
	LastError string `gorm:"type:varchar(512)" json:"lastError"`
	// Status idle / running / error
	Status string `gorm:"type:varchar(16)" json:"status"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

func (VaultGitBackup) TableName() string { return "vault_git_backups" }
