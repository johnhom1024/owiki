package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"owiki/internal/events"
	"owiki/internal/feature"
	"owiki/internal/hub"
	"owiki/internal/proto"
	"owiki/internal/repository"
	"owiki/internal/service"
	// 触发 webapi 的 feature.Register init（share 等功能的注册表）。
	// 生产中由 main 装配完成；ws 包测试需自行拉起。webapi 不依赖 ws，无循环。
	_ "owiki/internal/webapi"

	"github.com/gorilla/websocket"
)

// shareTestConn 一个已通过 hello 认证的测试 WS 连接。
type shareTestConn struct {
	t     *testing.T
	ws    *websocket.Conn
	vid   int64
	repo  *repository.NoteRepo
	share *repository.ShareRepo
}

func setupShareTest(t *testing.T) *shareTestConn {
	t.Helper()
	dir := t.TempDir()
	repo, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	vaultRepo, err := repository.NewVaultRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	deviceRepo, err := repository.NewDeviceRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	syncLog, err := repository.NewSyncLogRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	share, err := repository.NewShareRepo(repo.DB())
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(dir, "att"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := vaultRepo.Create(context.Background(), "test-vault", "")
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(hub.New(), repo, vaultRepo, deviceRepo, events.NewHub(), attach, syncLog, share)
	server := httptest.NewServer(http.HandlerFunc(s.Handle))
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wsConn.Close() })

	_ = wsConn.WriteJSON(proto.Hello{Type: "hello", Token: v.Token, DeviceID: "dev-share-test"})
	c := &shareTestConn{t: t, ws: wsConn, vid: v.ID, repo: repo, share: share}
	var w proto.Welcome
	c.recv(&w)
	if !w.OK {
		t.Fatalf("hello auth failed: %+v", w)
	}
	return c
}

func (c *shareTestConn) send(v interface{}) {
	c.t.Helper()
	if err := c.ws.WriteJSON(v); err != nil {
		c.t.Fatal(err)
	}
}

// recv 读下一条非 ping 消息反序列化到 v（跳过服务端心跳）
func (c *shareTestConn) recv(v interface{}) {
	c.t.Helper()
	_ = c.ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			c.t.Fatal(err)
		}
		var env struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(data, &env) != nil || env.Type == "ping" {
			continue
		}
		if err := json.Unmarshal(data, v); err != nil {
			c.t.Fatalf("unmarshal %s: %v", data, err)
		}
		return
	}
}

func saveNote(t *testing.T, repo *repository.NoteRepo, vid int64, path string) int64 {
	t.Helper()
	// Hash 留空：service.Save 会自己算内容 SHA-256（传错值会 ErrHashMismatch）
	res, err := service.Save(context.Background(), repo, service.SaveInput{
		VaultID: vid, Path: path, Content: "# t\n", Mtime: time.Now().Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Note.ID
}

func TestShareQueryCreatesToken(t *testing.T) {
	c := setupShareTest(t)
	noteID := saveNote(t, c.repo, c.vid, "notes/a.md")

	c.send(proto.Share{Type: "share", Path: "notes/a.md"})
	var resp proto.ShareResponse
	c.recv(&resp)
	if resp.Type != "share_response" || resp.Path != "notes/a.md" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if resp.Enabled {
		t.Fatal("first query should return enabled=false")
	}
	if len(resp.Token) != 8 {
		t.Fatalf("token should be 8 chars, got %q", resp.Token)
	}
	sh, err := c.share.GetByNoteID(context.Background(), noteID)
	if err != nil || sh.Token != resp.Token {
		t.Fatalf("db share mismatch: %+v err=%v", sh, err)
	}
}

func TestShareToggleKeepsToken(t *testing.T) {
	c := setupShareTest(t)
	noteID := saveNote(t, c.repo, c.vid, "notes/b.md")

	on := true
	c.send(proto.Share{Type: "share", Path: "notes/b.md", Enabled: &on})
	var r1 proto.ShareResponse
	c.recv(&r1)
	if !r1.Enabled || r1.Token == "" {
		t.Fatalf("enable failed: %+v", r1)
	}

	off := false
	c.send(proto.Share{Type: "share", Path: "notes/b.md", Enabled: &off})
	var r2 proto.ShareResponse
	c.recv(&r2)
	if r2.Enabled || r2.Token != r1.Token {
		t.Fatalf("token must be stable across toggles: r1=%+v r2=%+v", r1, r2)
	}

	sh, err := c.share.GetByNoteID(context.Background(), noteID)
	if err != nil || sh.Token != r1.Token || sh.Enabled {
		t.Fatalf("db mismatch: %+v err=%v", sh, err)
	}
}

func TestShareUnknownNoteRejected(t *testing.T) {
	c := setupShareTest(t)
	c.send(proto.Share{Type: "share", Path: "ghost/none.md"})
	var e proto.Err
	c.recv(&e)
	if e.Type != "error" || !strings.Contains(e.Message, "not found") {
		t.Fatalf("expected not-found error, %v", e)
	}
}

func TestShareFeatureDisabled(t *testing.T) {
	// share 注册表由 webapi init 拉起（见 import blank import）
	if !feature.Use().SetEnabled("share", false) {
		t.Fatal("failed to disable share feature")
	}
	t.Cleanup(func() { _ = feature.Use().SetEnabled("share", true) })

	c := setupShareTest(t)
	saveNote(t, c.repo, c.vid, "notes/c.md")
	c.send(proto.Share{Type: "share", Path: "notes/c.md"})
	var e proto.Err
	c.recv(&e)
	if e.Type != "error" || !strings.Contains(e.Message, "disabled") {
		t.Fatalf("expected disabled error, got %+v", e)
	}
}
