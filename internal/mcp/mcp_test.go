package mcp_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"owiki/internal/hub"
	owikimcp "owiki/internal/mcp"
	"owiki/internal/repository"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type headerRoundTripper struct {
	base   http.RoundTripper
	header http.Header
}

func (h headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	for k, vs := range h.header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	return h.base.RoundTrip(req)
}

func setup(t *testing.T) (endpoint, plaintext string, vid int64, srv *httptest.Server) {
	t.Helper()
	gin.SetMode(gin.TestMode)
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
	apiKeyRepo, err := repository.NewApiKeyRepo(repo.DB())
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
	v, err := vaultRepo.Create(context.Background(), "test", "")
	if err != nil {
		t.Fatal(err)
	}
	plain, hash, prefix := repository.GenerateApiKey()
	if _, err := apiKeyRepo.Create(context.Background(), "e2e", hash, prefix, 0, false); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	owikimcp.New(repo, vaultRepo, apiKeyRepo, attach, deviceRepo, hub.New(), syncLog, share, "test").Register(r)
	ts := httptest.NewServer(r)
	t.Cleanup(ts.Close)
	return ts.URL + "/mcp", plain, v.ID, ts
}

func connect(t *testing.T, endpoint, key string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "e2e", Version: "test"}, nil)
	tr := &mcp.StreamableClientTransport{
		Endpoint: endpoint,
		HTTPClient: &http.Client{Transport: headerRoundTripper{
 base:   http.DefaultTransport,
			header: http.Header{"X-API-Key": []string{key}},
		}},
	}
	sess, err := client.Connect(context.Background(), tr, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	return sess
}

func call(t *testing.T, sess *mcp.ClientSession, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	res, err := sess.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("CallTool %s: %v", name, err)
	}
	if res.IsError {
		t.Fatalf("CallTool %s returned error: %+v", name, res.Content)
	}
	return res
}

func TestMCPNotesCRUD(t *testing.T) {
	endpoint, key, _, _ := setup(t)
	sess := connect(t, endpoint, key)

	tools, err := sess.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"list_vaults": true, "list_notes": true, "read_note": true, "write_note": true,
		"append_note": true, "rename_note": true, "delete_note": true, "search_notes": true,
		"list_tags": true, "find_by_tag": true, "get_outlinks": true, "get_backlinks": true,
		"find_broken_links": true, "find_orphans": true, "get_vault_stats": true,
		"get_recent_changes": true, "list_devices": true, "get_server_info": true,
		"get_share": true, "set_share": true, "read_attachment": true,
	}
	got := map[string]bool{}
	for _, tl := range tools.Tools {
		got[tl.Name] = true
	}
	for name := range want {
		if !got[name] {
			t.Errorf("missing tool %s", name)
		}
	}

	call(t, sess, "write_note", map[string]any{
		"path": "hello.md", "content": "# hello\n\n[[world]] #demo\n",
	})
	call(t, sess, "write_note", map[string]any{
		"path": "world.md", "content": "# world\n\nback to [[hello]]\n",
	})

	res := call(t, sess, "read_note", map[string]any{"path": "hello.md"})
	if len(res.Content) == 0 {
		t.Fatal("empty read")
	}

	call(t, sess, "append_note", map[string]any{
		"path": "hello.md", "content": "appended line\n",
	})

	call(t, sess, "search_notes", map[string]any{"query": "demo"})
	call(t, sess, "list_tags", map[string]any{})
	call(t, sess, "get_outlinks", map[string]any{"path": "hello.md"})
	call(t, sess, "get_backlinks", map[string]any{"path": "hello.md"})
	call(t, sess, "find_orphans", map[string]any{})
	call(t, sess, "get_vault_stats", map[string]any{})
	call(t, sess, "get_server_info", map[string]any{})
	call(t, sess, "get_recent_changes", map[string]any{})

	call(t, sess, "rename_note", map[string]any{"from": "world.md", "to": "world2.md"})
	call(t, sess, "delete_note", map[string]any{"path": "world2.md", "confirm": "world2.md"})
}

func TestMCPAuthRequired(t *testing.T) {
	endpoint, _, _, _ := setup(t)
	client := mcp.NewClient(&mcp.Implementation{Name: "e2e", Version: "test"}, nil)
	_, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: endpoint}, nil)
	if err == nil {
		t.Fatal("expected auth error without key")
	}
}

func TestMCPReadOnlyKeyHidesWriteTools(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	repo, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	vaultRepo, _ := repository.NewVaultRepo(repo.DB())
	deviceRepo, _ := repository.NewDeviceRepo(repo.DB())
	apiKeyRepo, _ := repository.NewApiKeyRepo(repo.DB())
	syncLog, _ := repository.NewSyncLogRepo(repo.DB())
	share, _ := repository.NewShareRepo(repo.DB())
	attach, _ := repository.NewAttachStore(filepath.Join(dir, "att"))
	if _, err := vaultRepo.Create(context.Background(), "test", ""); err != nil {
		t.Fatal(err)
	}
	plain, hash, prefix := repository.GenerateApiKey()
	if _, err := apiKeyRepo.Create(context.Background(), "ro", hash, prefix, 0, true); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	owikimcp.New(repo, vaultRepo, apiKeyRepo, attach, deviceRepo, hub.New(), syncLog, share, "test").Register(r)
	ts := httptest.NewServer(r)
	t.Cleanup(ts.Close)

	sess := connect(t, ts.URL+"/mcp", plain)
	tools, err := sess.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tl := range tools.Tools {
		switch tl.Name {
		case "write_note", "append_note", "rename_note", "delete_note", "set_share":
			t.Errorf("read-only key should not expose %s", tl.Name)
		}
	}
}

func TestMCPQueryKeyFallback(t *testing.T) {
	endpoint, key, _, _ := setup(t)
	client := mcp.NewClient(&mcp.Implementation{Name: "e2e", Version: "test"}, nil)
	sess, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: endpoint + "?key=" + key,
	}, nil)
	if err != nil {
		t.Fatalf("connect via ?key=: %v", err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	if _, err := sess.ListTools(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
