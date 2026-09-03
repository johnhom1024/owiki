package mcp

import (
	"context"
	"errors"
	"strings"

	"owiki/internal/model"
	"owiki/internal/openapi"
	"owiki/internal/repository"
	"owiki/internal/service"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ActorName sync_log 与广播中的操作者展示名（MCP 来源统一记这个）。
const ActorName = "MCP Client"

// ---------- 输入/输出 schema 类型 ----------

type listVaultsIn struct{}
type listVaultsOut struct {
	Vaults []vaultInfo `json:"vaults" jsonschema:"vaults accessible to this key"`
}

type vaultInfo struct {
	ID   int64  `json:"id" jsonschema:"vault id"`
	Name string `json:"name" jsonschema:"vault name"`
	Note string `json:"note" jsonschema:"vault note"`
}

type listNotesIn struct {
	Vault  string `json:"vault,omitempty" jsonschema:"vault id or name; required for multi-vault servers"`
	Folder string `json:"folder,omitempty" jsonschema:"only notes under this folder (prefix match), e.g. \"日记\""`
	Limit  int    `json:"limit,omitempty" jsonschema:"max notes to return (default 100, max 500)"`
	Full   bool   `json:"full,omitempty" jsonschema:"include note content (heavier; default false)"`
}
type listNotesOut struct {
	Total int         `json:"total" jsonschema:"number of notes returned"`
	Notes []noteMeta  `json:"notes" jsonschema:"note list"`
}

type noteMeta struct {
	Path     string `json:"path"`
	Mtime    int64  `json:"mtime"`
	Size     int64  `json:"size"`
	Content  string `json:"content,omitempty"`
}

type readNoteIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path  string `json:"path" jsonschema:"note path inside the vault, e.g. \"日记/2026-08.md\""`
}
type readNoteOut struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash" jsonschema:"pass this as baseHash when updating this note"`
	Mtime       int64  `json:"mtime"`
	Size        int64  `json:"size"`
}

type writeNoteIn struct {
	Vault    string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path     string `json:"path" jsonschema:"note path inside the vault"`
	Content  string `json:"content" jsonschema:"full note content (markdown)"`
	BaseHash string `json:"baseHash,omitempty" jsonschema:"contentHash from your last read; prevents overwriting concurrent edits (409 on mismatch)"`
	Force    bool   `json:"force,omitempty" jsonschema:"overwrite even if baseHash mismatches (dangerous)"`
}
type writeNoteOut struct {
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	Created     bool   `json:"created"`
	Merged      bool   `json:"merged" jsonschema:"true if a three-way merge was applied"`
}

type appendNoteIn struct {
	Vault   string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path    string `json:"path" jsonschema:"note path inside the vault"`
	Content string `json:"content" jsonschema:"text to append to the end of the note"`
	Create  bool   `json:"create,omitempty" jsonschema:"create the note if it does not exist (default false)"`
}
type appendNoteOut struct {
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	Appended    bool   `json:"appended"`
}

type renameNoteIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	From  string `json:"from" jsonschema:"current note path"`
	To    string `json:"to" jsonschema:"new note path"`
}
type renameNoteOut struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type deleteNoteIn struct {
	Vault   string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path    string `json:"path" jsonschema:"note path to delete"`
	Confirm string `json:"confirm" jsonschema:"must equal the note path; guards against accidental deletion"`
}
type deleteNoteOut struct {
	Deleted bool `json:"deleted"`
}

type searchNotesIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Query string `json:"query" jsonschema:"keyword matched against path and content (case-insensitive substring)"`
	Limit int    `json:"limit,omitempty" jsonschema:"max hits (default 20, max 50)"`
}
type searchNotesOut struct {
	Query string    `json:"query"`
	Total int       `json:"total"`
	Hits  []searchHit `json:"hits"`
}

type searchHit struct {
	Path    string `json:"path"`
	Snippet string `json:"snippet"`
}

// ---------- 注册 ----------

// registerReadTools 注册只读笔记工具。
func (s *Server) registerReadTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_vaults",
		Description: "List vaults accessible to this API key.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.listVaults)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_notes",
		Description: "List notes in a vault (metadata only by default; path matches Obsidian). Use folder to filter by top folder.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.listNotes)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "read_note",
		Description: "Read one note: content, mtime, size, and contentHash. Use contentHash as baseHash when writing back.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.readNote)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search_notes",
		Description: "Search notes by keyword (case-insensitive substring over path and content). Returns path + snippet.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.searchNotes)
}

// registerWriteTools 注册写工具（readOnly key 不挂这些）。
func (s *Server) registerWriteTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "write_note",
		Description: "Create or update a note (upsert). Pass baseHash from your last read to avoid overwriting concurrent edits; on conflict, re-read and merge, or force=true to overwrite.",
	}, s.writeNote)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "append_note",
		Description: "Append text to the end of a note. Safer than read-modify-write for logs and diaries: concurrent edits are merged, not lost.",
	}, s.appendNote)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "rename_note",
		Description: "Rename or move a note.",
	}, s.renameNote)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "delete_note",
		Description: "Delete a note (also deletes the local file on synced Obsidian clients). Destructive: requires confirm=path.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: boolPtr(true)},
	}, s.deleteNote)
}

func boolPtr(b bool) *bool { return &b }

// ---------- handlers ----------

func (s *Server) listVaults(ctx context.Context, req *mcp.CallToolRequest, in listVaultsIn) (*mcp.CallToolResult, listVaultsOut, error) {
	k, err := s.keyFromRequest(req)
	if err != nil {
		return nil, listVaultsOut{}, err
	}
	vaults, err := s.vaultRepo.List(ctx)
	if err != nil {
		return nil, listVaultsOut{}, err
	}
	out := listVaultsOut{Vaults: make([]vaultInfo, 0, len(vaults))}
	for _, v := range vaults {
		if k.VaultScope != 0 && k.VaultScope != v.ID {
			continue
		}
		out.Vaults = append(out.Vaults, vaultInfo{ID: v.ID, Name: v.Name, Note: v.Note})
	}
	return nil, out, nil
}

func (s *Server) listNotes(ctx context.Context, req *mcp.CallToolRequest, in listNotesIn) (*mcp.CallToolResult, listNotesOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, listNotesOut{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	var notes []model.Note
	if in.Full {
		notes, err = s.repo.ListWithContent(ctx, vid)
	} else {
		notes, err = s.repo.ListAll(ctx, vid, false)
	}
	if err != nil {
		return nil, listNotesOut{}, err
	}
	out := listNotesOut{Notes: make([]noteMeta, 0, len(notes))}
	for _, n := range notes {
		if in.Folder != "" && !strings.HasPrefix(n.Path, in.Folder+"/") && n.Path != in.Folder {
			continue
		}
		if len(out.Notes) >= limit {
			break
		}
		m := noteMeta{Path: n.Path, Mtime: n.Mtime, Size: n.Size}
		if in.Full {
			m.Content = n.Content
		}
		out.Notes = append(out.Notes, m)
	}
	out.Total = len(out.Notes)
	return nil, out, nil
}

func (s *Server) readNote(ctx context.Context, req *mcp.CallToolRequest, in readNoteIn) (*mcp.CallToolResult, readNoteOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, readNoteOut{}, err
	}
	if in.Path == "" {
		return nil, readNoteOut{}, errors.New("path required")
	}
	note, err := s.repo.GetByPath(ctx, vid, in.Path)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, readNoteOut{}, &notFoundError{path: in.Path}
	}
	if err != nil {
		return nil, readNoteOut{}, err
	}
	return nil, readNoteOut{
		Path: note.Path, Content: note.Content, ContentHash: note.ContentHash,
		Mtime: note.Mtime, Size: note.Size,
	}, nil
}

func (s *Server) writeNote(ctx context.Context, req *mcp.CallToolRequest, in writeNoteIn) (*mcp.CallToolResult, writeNoteOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, writeNoteOut{}, err
	}
	if in.Path == "" {
		return nil, writeNoteOut{}, errors.New("path required")
	}
	res, err := openapi.WriteNote(ctx, s.repo, s.syncLog, s.hub, vid, in.Path, in.Content, in.BaseHash, in.Force, repository.SourceMCP, ActorName)
	if err != nil {
		var ce *service.ConflictError
		if errors.As(err, &ce) {
			return nil, writeNoteOut{}, &conflictError{serverHash: ce.Server.ContentHash, hint: ce.Hint}
		}
		return nil, writeNoteOut{}, err
	}
	return nil, writeNoteOut{
		Path: res.Note.Path, ContentHash: res.Note.ContentHash, Created: res.Created, Merged: res.Merged,
	}, nil
}

func (s *Server) appendNote(ctx context.Context, req *mcp.CallToolRequest, in appendNoteIn) (*mcp.CallToolResult, appendNoteOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, appendNoteOut{}, err
	}
	if in.Path == "" {
		return nil, appendNoteOut{}, errors.New("path required")
	}
	// 读现内容 → 拼接 → 走共享写路径（乐观锁天然生效：并发修改走三方合并）
	note, err := s.repo.GetByPath(ctx, vid, in.Path)
	if errors.Is(err, repository.ErrNotFound) {
		if !in.Create {
			return nil, appendNoteOut{}, &notFoundError{path: in.Path}
		}
		res, err := openapi.WriteNote(ctx, s.repo, s.syncLog, s.hub, vid, in.Path, in.Content, "", false, repository.SourceMCP, ActorName)
		if err != nil {
			return nil, appendNoteOut{}, err
		}
		return nil, appendNoteOut{Path: res.Note.Path, ContentHash: res.Note.ContentHash, Appended: true}, nil
	}
	if err != nil {
		return nil, appendNoteOut{}, err
	}
	content := note.Content
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += in.Content
	res, err := openapi.WriteNote(ctx, s.repo, s.syncLog, s.hub, vid, in.Path, content, note.ContentHash, false, repository.SourceMCP, ActorName)
	if err != nil {
		var ce *service.ConflictError
		if errors.As(err, &ce) {
			return nil, appendNoteOut{}, &conflictError{serverHash: ce.Server.ContentHash, hint: ce.Hint}
		}
		return nil, appendNoteOut{}, err
	}
	return nil, appendNoteOut{Path: res.Note.Path, ContentHash: res.Note.ContentHash, Appended: true}, nil
}

func (s *Server) renameNote(ctx context.Context, req *mcp.CallToolRequest, in renameNoteIn) (*mcp.CallToolResult, renameNoteOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, renameNoteOut{}, err
	}
	if in.From == "" || in.To == "" {
		return nil, renameNoteOut{}, errors.New("from and to required")
	}
	if err := openapi.RenameNote(ctx, s.repo, s.attach, s.syncLog, s.hub, vid, in.From, in.To, repository.SourceMCP, ActorName); err != nil {
		return nil, renameNoteOut{}, err
	}
	return nil, renameNoteOut{From: in.From, To: in.To}, nil
}

func (s *Server) deleteNote(ctx context.Context, req *mcp.CallToolRequest, in deleteNoteIn) (*mcp.CallToolResult, deleteNoteOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, deleteNoteOut{}, err
	}
	if in.Path == "" {
		return nil, deleteNoteOut{}, errors.New("path required")
	}
	if in.Confirm != in.Path {
		return nil, deleteNoteOut{}, errors.New("confirm must equal path (type the full path to confirm deletion)")
	}
	if err := openapi.DeleteNote(ctx, s.repo, s.attach, s.share, s.syncLog, s.hub, vid, in.Path, 0, repository.SourceMCP, ActorName); err != nil {
		return nil, deleteNoteOut{}, err
	}
	return nil, deleteNoteOut{Deleted: true}, nil
}

func (s *Server) searchNotes(ctx context.Context, req *mcp.CallToolRequest, in searchNotesIn) (*mcp.CallToolResult, searchNotesOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, searchNotesOut{}, err
	}
	q := strings.TrimSpace(in.Query)
	if q == "" {
		return nil, searchNotesOut{}, errors.New("query required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	notes, err := s.repo.ListWithContent(ctx, vid)
	if err != nil {
		return nil, searchNotesOut{}, err
	}
	out := searchNotesOut{Query: q, Hits: make([]searchHit, 0)}
	lq := strings.ToLower(q)
	for _, n := range notes {
		if strings.Contains(strings.ToLower(n.Path), lq) || strings.Contains(strings.ToLower(n.Content), lq) {
			snippet := n.Content
			idx := strings.Index(strings.ToLower(snippet), lq)
			if idx > 40 {
				snippet = "…" + snippet[idx-40:]
			}
			if len(snippet) > 200 {
				snippet = snippet[:200] + "…"
			}
			out.Hits = append(out.Hits, searchHit{Path: n.Path, Snippet: snippet})
			if len(out.Hits) >= limit {
				break
			}
		}
	}
	out.Total = len(out.Hits)
	return nil, out, nil
}

// ---------- helpers ----------

// keyFromRequest 从 MCP 请求透传的 HTTP 头中提取 API key 并验证。
// streamable transport 会把原始 HTTP header 放进 req.Extra.Header，
// auth 中间件里 ?key= 兜底路径也在这里重放。
func (s *Server) keyFromRequest(req *mcp.CallToolRequest) (*model.ApiKey, error) {
	key := ""
	if req.Extra != nil && req.Extra.Header != nil {
		key = req.Extra.Header.Get("X-API-Key")
		if key == "" {
			if auth := req.Extra.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
				key = strings.TrimPrefix(auth, "Bearer ")
			}
		}
	}
	if key == "" {
		return nil, errors.New("no api key on request")
	}
	k, ok := s.keys.Verify(context.Background(), key)
	if !ok {
		return nil, errors.New("invalid api key")
	}
	return k, nil
}

// requireVault 解析 vault 参数并校验 key 作用域，返回 vault id。
// vault 为空时：key 是全量 scope → 返回第一个 vault（单 vault 部署的便利默认）；
// 否则报错要求明确指定。
func (s *Server) requireVault(req *mcp.CallToolRequest, vault string) (int64, error) {
	k, err := s.keyFromRequest(req)
	if err != nil {
		return 0, err
	}
	vid, _, err := s.resolveVault(k, vault)
	if err != nil {
		return 0, err
	}
	return vid, nil
}

// notFoundError 404 语义的错误（客户端可读）
type notFoundError struct{ path string }

func (e *notFoundError) Error() string { return "note not found: " + e.path }

// conflictError 409 语义的错误：附带服务端当前 hash，模型可重新读取合并
type conflictError struct {
	serverHash string
	hint       string
}

func (e *conflictError) Error() string {
	return "conflict: note modified concurrently (serverHash=" + e.serverHash + "); re-read, merge, and retry, or force=true to overwrite"
}
