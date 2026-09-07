package agent

import (
	"context"
	"encoding/json"
	"time"

	"owiki/internal/model"
	"owiki/internal/repository"

	"trpc.group/trpc-go/trpc-agent-go/event"
	"trpc.group/trpc-go/trpc-agent-go/session"
)

// sqliteSessionService trpc session.Service 的 glebarez SQLite 实现。
// 会话元数据 → chat_sessions 表；事件流 → chat_events 表（JSON 载荷）；
// 会话状态 → settings 表（键 chat.state.<sid>）。
//
// trpc 官方 session/sqlite 子模块用 mattn（CGO），与 OWiki 纯 Go 编译
// 不兼容，故按开放接口自实现——调研报告预判的路径。
type sqliteSessionService struct {
	store *repository.ChatStore
}

// NewSessionService 建 trpc 会话服务（含必要的迁移）。
func NewSessionService(store *repository.ChatStore) session.Service {
	return &sqliteSessionService{store: store}
}

func sessKeyToModel(key session.Key) (appName, userID, sessionID string) {
	return key.AppName, key.UserID, key.SessionID
}

// CreateSession 实现 session.Service。
func (s *sqliteSessionService) CreateSession(ctx context.Context, key session.Key, state session.StateMap, _ ...session.Option) (*session.Session, error) {
	sess := session.NewSession(key.AppName, key.UserID, key.SessionID,
		session.WithSessionState(state),
		session.WithSessionCreatedAt(time.Now()),
		session.WithSessionUpdatedAt(time.Now()),
	)
	if err := s.store.CreateSession(ctx, &model.ChatSession{
		ID: key.SessionID, AppName: key.AppName, UserID: key.UserID,
	}); err != nil {
		return nil, err
	}
	if len(state) > 0 {
		if err := s.store.SaveSessionState(ctx, key.SessionID, state); err != nil {
			return nil, err
		}
	}
	return sess, nil
}

// GetSession 实现 session.Service：元数据 + 事件流 + 状态全量加载。
func (s *sqliteSessionService) GetSession(ctx context.Context, key session.Key, _ ...session.Option) (*session.Session, error) {
	appName, userID, sessionID := sessKeyToModel(key)
	if _, err := s.store.GetSession(ctx, appName, userID, sessionID); err != nil {
		// 不存在则建（trpc 语义：GetSession 是 get-or-create 的读侧配合，
		// runner 首次 Run 前会先 Get；建空会话保证后续 AppendEvent 有落点）
		return s.CreateSession(ctx, key, nil)
	}
	events, err := s.store.LoadEvents(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	state, err := s.store.LoadSessionState(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	opts := []session.SessionOptions{session.WithSessionState(state)}
	if len(events) > 0 {
		var evs []event.Event
		for _, raw := range events {
			var e event.Event
			if err := json.Unmarshal(raw, &e); err != nil {
				continue // 单条损坏跳过，不炸整个会话
			}
			evs = append(evs, e)
		}
		if len(evs) > 0 {
			opts = append(opts, session.WithSessionEvents(evs))
		}
	}
	return session.NewSession(appName, userID, sessionID, opts...), nil
}

// ListSessions 实现 session.Service（只回元数据）。
func (s *sqliteSessionService) ListSessions(ctx context.Context, userKey session.UserKey, _ ...session.Option) ([]*session.Session, error) {
	rows, err := s.store.ListSessions(ctx, userKey.AppName, userKey.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]*session.Session, 0, len(rows))
	for _, r := range rows {
		sess := session.NewSession(r.AppName, r.UserID, r.ID,
			session.WithSessionCreatedAt(r.CreatedAt),
			session.WithSessionUpdatedAt(r.UpdatedAt),
		)
		out = append(out, sess)
	}
	return out, nil
}

// DeleteSession 实现 session.Service。
func (s *sqliteSessionService) DeleteSession(ctx context.Context, key session.Key, _ ...session.Option) error {
	appName, userID, sessionID := sessKeyToModel(key)
	if err := s.store.DeleteSession(ctx, appName, userID, sessionID); err != nil {
		return err
	}
	return s.store.DeleteSessionState(ctx, sessionID)
}

// AppendEvent 实现 session.Service：事件序列化落库 + 会话 Touch。
func (s *sqliteSessionService) AppendEvent(ctx context.Context, sess *session.Session, e *event.Event, _ ...session.Option) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	title := ""
	if e != nil && e.Response != nil && len(e.Response.Choices) > 0 &&
		e.Response.Choices[0].Message.Role == "user" {
		title = truncateRunes(e.Response.Choices[0].Message.Content, 60)
	}
	if err := s.store.AppendEvents(ctx, sess.ID, []json.RawMessage{b}); err != nil {
		return err
	}
	return s.store.TouchSession(ctx, sess.AppName, sess.UserID, sess.ID, title)
}

// —— 以下状态方法：OWiki 不用 app/user 级状态，全部空实现 ——

func (s *sqliteSessionService) UpdateAppState(ctx context.Context, appName string, state session.StateMap) error {
	return nil
}

func (s *sqliteSessionService) DeleteAppState(ctx context.Context, appName string, key string) error {
	return nil
}

func (s *sqliteSessionService) ListAppStates(ctx context.Context, appName string) (session.StateMap, error) {
	return nil, nil
}

func (s *sqliteSessionService) UpdateUserState(ctx context.Context, userKey session.UserKey, state session.StateMap) error {
	return nil
}

func (s *sqliteSessionService) ListUserStates(ctx context.Context, userKey session.UserKey) (session.StateMap, error) {
	return nil, nil
}

func (s *sqliteSessionService) DeleteUserState(ctx context.Context, userKey session.UserKey, key string) error {
	return nil
}

func (s *sqliteSessionService) UpdateSessionState(ctx context.Context, key session.Key, state session.StateMap) error {
	return s.store.SaveSessionState(ctx, key.SessionID, state)
}

// CreateSessionSummary / EnqueueSummaryJob / GetSessionSummaryText：
// v1 不做会话摘要压缩（长会话直接全量重放，超长再评估）。
func (s *sqliteSessionService) CreateSessionSummary(ctx context.Context, sess *session.Session, filterKey string, force bool) error {
	return nil
}

func (s *sqliteSessionService) EnqueueSummaryJob(ctx context.Context, sess *session.Session, filterKey string, force bool) error {
	return nil
}

func (s *sqliteSessionService) GetSessionSummaryText(ctx context.Context, sess *session.Session, opts ...session.SummaryOption) (string, bool) {
	return "", false
}

func (s *sqliteSessionService) Close() error { return nil }

// truncateRunes 按字符截断（中文标题友好）。
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

var _ session.Service = (*sqliteSessionService)(nil)
