package model

import "time"

// SyncLog 一条同步活动记录：谁（设备）在什么时候对本 vault 做了什么（动作/文件）。
// 由服务端在处理 upload/delete/rename 等消息、Web 端编辑、开放 API 写入时落库，
// Web 管理端 vault 设置页的「同步日志」时间线展示用。
type SyncLog struct {
	ID      int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	VaultID int64  `gorm:"index:idx_synclog_vault_id;not null" json:"vaultId"`
	// Action 动作类型，见 repository 包内 Action* 常量
	Action string `gorm:"type:varchar(32);index:idx_synclog_vault_action;not null" json:"action"`
	// Path 文件路径；rename 时存「旧路径 → 新路径」
	Path string `gorm:"type:varchar(512)" json:"path"`
	// Detail 补充信息（合并提示、冲突原因、来源 IP 等）
	Detail string `gorm:"type:varchar(512)" json:"detail"`
	// Size 变更内容字节数（create/update 有效）
	Size int64 `json:"size"`
	// Source 操作来源：ws（插件）/ web（网页编辑）/ openapi（开放 API）
	Source string `gorm:"type:varchar(16)" json:"source"`
	// DeviceID / DeviceName 操作设备（ws 来源时来自 hello 上报；web/openapi 为空）
	DeviceID   string `gorm:"type:varchar(64)" json:"deviceId"`
	DeviceName string `gorm:"type:varchar(255)" json:"deviceName"`

	CreatedAt time.Time `gorm:"autoCreateTime;index:idx_synclog_created_at" json:"createdAt"`
}

// 表名（SQLite AutoMigrate 用默认复数形式 sync_logs）
func (SyncLog) TableName() string { return "sync_logs" }
