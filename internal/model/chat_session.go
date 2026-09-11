package model

import "time"

// ChatSession 对话会话元数据。事件体（消息流）单独存 ChatEvent 表，
// 元数据与内容分表是 trpc session.Service 的加载粒度决定的：
// ListSessions 只需元数据，GetSession 才需要事件。
type ChatSession struct {
	ID        string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	AppName   string    `gorm:"type:varchar(64);index:idx_chat_sess" json:"appName"`
	UserID    string    `gorm:"type:varchar(64);index:idx_chat_sess" json:"userId"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
	// Title 前端展示名（首条用户消息截断）。
	Title string `gorm:"type:varchar(255)" json:"title"`
}

// ChatEvent 会话内一条事件（用户消息 / 助理回复 / 工具调用 / 工具结果）。
// 序列化为 trpc event.Event 的 JSON（含 Response 载荷），加载时反序列化回去。
type ChatEvent struct {
	ID        int64          `gorm:"primaryKey;autoIncrement" json:"id"`
	SessionID string         `gorm:"type:varchar(64);index:idx_chat_ev_sid" json:"sessionId"`
	Seq       int            `gorm:"index:idx_chat_ev_sid" json:"seq"`
	Payload   string         `gorm:"type:text" json:"payload"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"createdAt"`
	State     map[string]any `gorm:"-" json:"-"`
}
