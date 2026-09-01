package model

import "time"

// Vault 一个同步库：一组笔记 + 独立的同步 token。
// 多 vault 共用一个 owiki 实例，彼此数据隔离。
type Vault struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Name      string    `gorm:"type:varchar(255);uniqueIndex;not null" json:"name"`
	Token     string    `gorm:"type:varchar(128);uniqueIndex;not null" json:"-"` // 同步令牌，不对外暴露
	Note      string    `gorm:"type:varchar(512)" json:"note"`                   // 备注/描述
	CreatedAt time.Time  `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time  `gorm:"autoUpdateTime" json:"updatedAt"`
	// LastSeenAt 最近一次 Obsidian 客户端认证成功的时间；
	// nil = 从未授权过。用作「已授权」状态展示。
	LastSeenAt *time.Time `gorm:"index" json:"lastSeenAt"`
	// SingleDevice 单设备同步模式：开启后只有 PinnedDeviceID 对应的设备
	// 能与本 vault 同步；其他设备的上传/下载请求会被拒绝。
	// 场景：多台 Mac 装了 Obsidian 且同时开 iCloud 同步——iCloud 已负责
	// 机器间文件同步，owiki 只需一台设备上传一份，避免重复上传与交叉竞态
	// （回声循环、"xxx 2.md" 冲突副本的根源）。
	SingleDevice   bool   `gorm:"not null;default:false" json:"singleDevice"`
	PinnedDeviceID string `gorm:"type:varchar(64)" json:"pinnedDeviceId"`
}
