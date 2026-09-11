package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"owiki/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	// ErrChatSessionNotFound 会话不存在。
	ErrChatSessionNotFound = errors.New("chat session not found")
)

// ChatStore 对话会话与事件的持久化（glebarez 纯 Go SQLite）。
// 实现 trpc session.Service 的存储底座：会话元数据 + 事件流 + 状态。
type ChatStore struct {
	db *gorm.DB
}

func NewChatStore(db *gorm.DB) (*ChatStore, error) {
	if err := db.AutoMigrate(&model.ChatSession{}, &model.ChatEvent{}); err != nil {
		return nil, err
	}
	// 早期 tag 把 idx_chat_sess 建成 (app_name, user_id) UNIQUE，
	// 同一用户只能有一条会话。GORM AutoMigrate 不会改已有 UNIQUE，
	// 这里显式拆掉后按非唯一复合索引重建。
	if db.Migrator().HasIndex(&model.ChatSession{}, "idx_chat_sess") {
		_ = db.Migrator().DropIndex(&model.ChatSession{}, "idx_chat_sess")
	}
	if err := db.Migrator().CreateIndex(&model.ChatSession{}, "idx_chat_sess"); err != nil {
		return nil, fmt.Errorf("rebuild idx_chat_sess: %w", err)
	}
	return &ChatStore{db: db}, nil
}

// CreateSession 插入会话元数据（已存在则忽略——幂等）。
func (s *ChatStore) CreateSession(ctx context.Context, sess *model.ChatSession) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(sess).Error
}

// GetSession 取会话元数据。
// 用 Find 而不是 First：新建会话时 0 行是预期路径，First 会让 GORM
// 把 record not found 打成 ERROR 日志，看起来像请求失败。
func (s *ChatStore) GetSession(ctx context.Context, appName, userID, sessionID string) (*model.ChatSession, error) {
	var cs model.ChatSession
	res := s.db.WithContext(ctx).
		Where("app_name = ? AND user_id = ? AND id = ?", appName, userID, sessionID).
		Limit(1).Find(&cs)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrChatSessionNotFound
	}
	return &cs, nil
}

// ListSessions 按用户列出会话（最新在前）。
func (s *ChatStore) ListSessions(ctx context.Context, appName, userID string) ([]model.ChatSession, error) {
	var out []model.ChatSession
	err := s.db.WithContext(ctx).
		Where("app_name = ? AND user_id = ?", appName, userID).
		Order("updated_at DESC").Limit(100).Find(&out).Error
	return out, err
}

// DeleteSession 删会话 + 连带事件。
func (s *ChatStore) DeleteSession(ctx context.Context, appName, userID, sessionID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("app_name = ? AND user_id = ? AND id = ?", appName, userID, sessionID).
			Delete(&model.ChatSession{}).Error; err != nil {
			return err
		}
		return tx.Where("session_id = ?", sessionID).Delete(&model.ChatEvent{}).Error
	})
}

// TouchSession 更新会话时间与标题。
func (s *ChatStore) TouchSession(ctx context.Context, appName, userID, sessionID, title string) error {
	updates := map[string]any{"updated_at": time.Now()}
	if title != "" {
		// 标题只在为空时填（首条用户消息截断），后续不覆盖。
		updates["title"] = gorm.Expr("CASE WHEN title = '' THEN ? ELSE title END", title)
	}
	res := s.db.WithContext(ctx).Model(&model.ChatSession{}).
		Where("app_name = ? AND user_id = ? AND id = ?", appName, userID, sessionID).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrChatSessionNotFound
	}
	return nil
}

// AppendEvents 追加事件（seq 递增，事务内取 max+1）。
func (s *ChatStore) AppendEvents(ctx context.Context, sessionID string, payloads []json.RawMessage) error {
	if len(payloads) == 0 {
		return nil
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var maxSeq *int
		if err := tx.Model(&model.ChatEvent{}).Where("session_id = ?", sessionID).
			Select("MAX(seq)").Scan(&maxSeq).Error; err != nil {
			return err
		}
		next := 1
		if maxSeq != nil {
			next = *maxSeq + 1
		}
		rows := make([]model.ChatEvent, len(payloads))
		for i, p := range payloads {
			rows[i] = model.ChatEvent{SessionID: sessionID, Seq: next + i, Payload: string(p)}
		}
		return tx.Create(&rows).Error
	})
}

// LoadEvents 加载事件（seq 升序）。
func (s *ChatStore) LoadEvents(ctx context.Context, sessionID string) ([]json.RawMessage, error) {
	var rows []model.ChatEvent
	err := s.db.WithContext(ctx).Where("session_id = ?", sessionID).
		Order("seq ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, len(rows))
	for i, r := range rows {
		out[i] = json.RawMessage(r.Payload)
	}
	return out, nil
}

// SaveSessionState 存会话级状态（JSON 序列化 StateMap）。
// 复用 settings 表，键 chat.state.<sessionID>。
func (s *ChatStore) SaveSessionState(ctx context.Context, sessionID string, state map[string][]byte) error {
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	row := model.Setting{Key: "chat.state." + sessionID, Value: string(b)}
	return s.db.WithContext(ctx).Clauses(onConflictUpdateValue()).Create(&row).Error
}

// LoadSessionState 读会话级状态。
func (s *ChatStore) LoadSessionState(ctx context.Context, sessionID string) (map[string][]byte, error) {
	var row model.Setting
	res := s.db.WithContext(ctx).Where("key = ?", "chat.state."+sessionID).Limit(1).Find(&row)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, nil
	}
	var out map[string][]byte
	if err := json.Unmarshal([]byte(row.Value), &out); err != nil {
		return nil, fmt.Errorf("chat state corrupt: %w", err)
	}
	return out, nil
}

// DeleteSessionState 删会话状态（会话删除连带）。
func (s *ChatStore) DeleteSessionState(ctx context.Context, sessionID string) error {
	return s.db.WithContext(ctx).Where("key = ?", "chat.state."+sessionID).Delete(&model.Setting{}).Error
}

func onConflictUpdateValue() clause.OnConflict {
	return clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}
}
