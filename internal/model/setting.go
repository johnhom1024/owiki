package model

import "time"

// Setting 通用 key-value 配置。当前用途：feature 开关持久化
// （键形如 feature.<id>.enabled，值 "true"/"false"），后续其他系统
// 配置也可复用本表。feature 开关的用户值存在这里，重启后保持不变。
type Setting struct {
	Key       string    `gorm:"primaryKey;type:varchar(128)" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}
