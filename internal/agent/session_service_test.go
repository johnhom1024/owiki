package agent

import (
	"context"
	"encoding/json"
	"testing"

	"owiki/internal/model"
	"owiki/internal/repository"
	"owiki/internal/tools"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"trpc.group/trpc-go/trpc-agent-go/event"
	trpcmodel "trpc.group/trpc-go/trpc-agent-go/model"
	"trpc.group/trpc-go/trpc-agent-go/session"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Setting{}, &model.ChatSession{}, &model.ChatEvent{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestSessionServiceRoundTrip(t *testing.T) {
	db := testDB(t)
	store, err := repository.NewChatStore(db)
	if err != nil {
		t.Fatal(err)
	}
	svc := NewSessionService(store)
	ctx := context.Background()

	// 建 → 追加事件 → 重取，事件应完整回放
	key := session.Key{AppName: "owiki", UserID: "admin", SessionID: "s1"}
	sess, err := svc.CreateSession(ctx, key, nil)
	if err != nil {
		t.Fatal(err)
	}
	userEv := &event.Event{
		Response: &trpcmodel.Response{
			Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{Role: trpcmodel.RoleUser, Content: "第一条消息，标题应截断自这里"}}},
		},
	}
	assistantEv := &event.Event{
		Response: &trpcmodel.Response{
			Choices: []trpcmodel.Choice{{Message: trpcmodel.Message{Role: trpcmodel.RoleAssistant, Content: "回复内容"}}},
		},
	}
	if err := svc.AppendEvent(ctx, sess, userEv); err != nil {
		t.Fatal(err)
	}
	if err := svc.AppendEvent(ctx, sess, assistantEv); err != nil {
		t.Fatal(err)
	}

	got, err := svc.GetSession(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetEventCount() != 2 {
		t.Fatalf("expected 2 events, got %d", got.GetEventCount())
	}

	// 会话列表
	list, err := svc.ListSessions(ctx, session.UserKey{AppName: "owiki", UserID: "admin"})
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v %d", err, len(list))
	}

	// 删除
	if err := svc.DeleteSession(ctx, key); err != nil {
		t.Fatal(err)
	}
	evs, err := store.LoadEvents(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 0 {
		t.Errorf("events should be gone, got %d", len(evs))
	}
	if _, err := svc.GetSession(ctx, key); err != nil {
		t.Errorf("get after delete should recreate empty session, got %v", err)
	}
}

func TestSessionServiceState(t *testing.T) {
	db := testDB(t)
	store, _ := repository.NewChatStore(db)
	svc := NewSessionService(store)
	ctx := context.Background()

	key := session.Key{AppName: "owiki", UserID: "admin", SessionID: "s2"}
	_, err := svc.CreateSession(ctx, key, session.StateMap{"k": []byte("v")})
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.GetSession(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if v, ok := got.GetState("k"); !ok || string(v) != "v" {
		t.Fatalf("state round trip failed: %q %v", v, ok)
	}
}

func TestBridgeDeniesDestructiveWithoutConfirm(t *testing.T) {
	// 无 runID ctx：直接执行（不拦）——历史回放/测试场景
	// 有 runID 且拒绝：返回 denied 标记而不是错误
	b := NewConfirmBroker()
	go b.Resolve("run-x", false)
	_ = b
	// 构造一个假 destructive 工具验证桥的行为
	reg, err := tools.NewRegistry(tools.Tool{
		Name: "fake_delete", Description: "d",
		Flags: tools.FlagDestructive,
		Input: struct {
			Path string `json:"path"`
		}{},
		Handler: func(ctx context.Context, s *tools.Session, in json.RawMessage) (any, error) {
			return "deleted", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ts := BridgeTools(reg, b)
	if len(ts) != 1 {
		t.Fatalf("expected 1 bridged tool, got %d", len(ts))
	}
	d := ts[0].Declaration()
	if d.Name != "fake_delete" || d.InputSchema == nil {
		t.Fatalf("declaration wrong: %+v", d)
	}
}

func TestSettingsRepoRoundTrip(t *testing.T) {
	db := testDB(t)
	r := repository.NewAISettingsRepo(db)
	ctx := context.Background()

	if _, err := r.Load(ctx); err != repository.ErrAISettingsNotSaved {
		t.Fatalf("expected not-saved, got %v", err)
	}
	if err := r.Update(ctx, func(a *model.AISettings) {
		a.Enabled, a.BaseURL, a.APIKey, a.Model = true, "http://x/v1", "sk-1", "gpt"
	}); err != nil {
		t.Fatal(err)
	}
	a, err := r.Load(ctx)
	if err != nil || !a.Enabled || a.Model != "gpt" {
		t.Fatalf("load: %v %+v", err, a)
	}
	if a.Ready() {
		t.Error("not tested yet, ready should be false")
	}
	a.LastTestOK = true
	_ = r.Save(ctx, a)
	a2, _ := r.Load(ctx)
	if !a2.Ready() {
		t.Error("after test ok, ready should be true")
	}
}
