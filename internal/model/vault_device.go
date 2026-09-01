package model

import "time"

// VaultDevice 一个被授权连接某 vault 的 Obsidian 设备。
// deviceId 由插件首载生成（UUID），服务端据此识别设备、
// 用于设备列表展示与「已授权」状态判定。
type VaultDevice struct {
	ID     int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	VaultID int64 `gorm:"index;not null" json:"vaultId"`
	// DeviceID 客户端生成的稳定 UUID，(vault_id, device_id) 唯一
	DeviceID   string    `gorm:"type:varchar(64);uniqueIndex:idx_device_per_vault;not null" json:"deviceId"`
	DeviceName string    `gorm:"type:varchar(255)" json:"deviceName"`
	// ClientVersion 客户端插件版本（来自 hello.clientVersion），Web 端设备列表展示。
	// 老客户端未带该字段时为空串，向后兼容。
	ClientVersion string    `gorm:"type:varchar(32)" json:"clientVersion"`
	LastSeenAt time.Time `gorm:"autoUpdateTime" json:"lastSeenAt"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"createdAt"`
}
