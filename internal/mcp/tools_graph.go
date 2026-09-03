package mcp

import (
	"context"
	"path"
	"regexp"
	"sort"
	"strings"

	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Obsidian 风格的 wikilink 与 tag 解析（与笔记内容约定一致，不依赖插件）。
var (
	// [[Note Name]] / [[Note Name|alias]] / [[folder/Note]] / [[Note#heading]]
	reWikilink = regexp.MustCompile(`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]`)
	// #tag 或 #nested/tag；排除 markdown heading（行首 # 后空格）
	reTag = regexp.MustCompile(`(?:^|[^#\p{L}\p{N}_])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)`)
)

type vaultArg struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}

type listTagsIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type listTagsOut struct {
	Tags []tagCount `json:"tags"`
}
type tagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

type findByTagIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Tag   string `json:"tag" jsonschema:"tag to search for (without the leading #)"`
}
type findByTagOut struct {
	Tag   string   `json:"tag"`
	Paths []string `json:"paths"`
}

type linksIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
	Path  string `json:"path" jsonschema:"note path whose links to inspect"`
}
type linksOut struct {
	Path  string   `json:"path"`
	Links []string `json:"links"`
}

type findBrokenIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type findBrokenOut struct {
	Broken []brokenLink `json:"broken"`
}
type brokenLink struct {
	From string `json:"from" jsonschema:"note that contains the broken link"`
	To   string `json:"to" jsonschema:"target that does not exist"`
}

type findOrphansIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type findOrphansOut struct {
	Orphans []string `json:"orphans" jsonschema:"notes with no incoming wikilinks"`
}

type vaultStatsIn struct {
	Vault string `json:"vault,omitempty" jsonschema:"vault id or name"`
}
type vaultStatsOut struct {
	TotalNotes int            `json:"totalNotes"`
	TotalSize  int64          `json:"totalSize"`
	Folders    []folderCount  `json:"folders"`
	Recent     []recentNote   `json:"recent"`
}
type folderCount struct {
	Folder string `json:"folder"`
	Count  int    `json:"count"`
}
type recentNote struct {
	Path  string `json:"path"`
	Mtime int64  `json:"mtime"`
}

func (s *Server) registerGraphTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_tags",
		Description: "List all #tags in a vault with occurrence counts.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.listTags)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "find_by_tag",
		Description: "Find notes that contain a given #tag.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.findByTag)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_outlinks",
		Description: "List [[wikilink]] targets that a note points to.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.getOutlinks)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_backlinks",
		Description: "List notes that [[wikilink]] to the given note.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.getBacklinks)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "find_broken_links",
		Description: "Find [[wikilink]]s that point to notes that do not exist.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.findBrokenLinks)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "find_orphans",
		Description: "Find notes with no incoming [[wikilink]]s (orphans). Useful for cleanup.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.findOrphans)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_vault_stats",
		Description: "Vault overview: note count, size, folder distribution, recently modified notes.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.getVaultStats)
}

func (s *Server) listTags(ctx context.Context, req *mcp.CallToolRequest, in listTagsIn) (*mcp.CallToolResult, listTagsOut, error) {
	notes, err := s.markdownNotes(ctx, req, in.Vault)
	if err != nil {
		return nil, listTagsOut{}, err
	}
	counts := map[string]int{}
	for _, n := range notes {
		for _, t := range extractTags(n.Content) {
			counts[t]++
		}
	}
	out := listTagsOut{Tags: make([]tagCount, 0, len(counts))}
	for t, c := range counts {
		out.Tags = append(out.Tags, tagCount{Tag: t, Count: c})
	}
	sort.Slice(out.Tags, func(i, j int) bool { return out.Tags[i].Count > out.Tags[j].Count })
	return nil, out, nil
}

func (s *Server) findByTag(ctx context.Context, req *mcp.CallToolRequest, in findByTagIn) (*mcp.CallToolResult, findByTagOut, error) {
	if in.Tag == "" {
		return nil, findByTagOut{}, errTagRequired
	}
	tag := strings.TrimPrefix(in.Tag, "#")
	notes, err := s.markdownNotes(ctx, req, in.Vault)
	if err != nil {
		return nil, findByTagOut{}, err
	}
	out := findByTagOut{Tag: tag, Paths: make([]string, 0)}
	for _, n := range notes {
		for _, t := range extractTags(n.Content) {
			if strings.EqualFold(t, tag) {
				out.Paths = append(out.Paths, n.Path)
				break
			}
		}
	}
	return nil, out, nil
}

func (s *Server) getOutlinks(ctx context.Context, req *mcp.CallToolRequest, in linksIn) (*mcp.CallToolResult, linksOut, error) {
	if in.Path == "" {
		return nil, linksOut{}, errPathRequired
	}
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, linksOut{}, err
	}
	note, err := s.repo.GetByPath(ctx, vid, in.Path)
	if err != nil {
		return nil, linksOut{}, err
	}
	return nil, linksOut{Path: note.Path, Links: extractWikilinks(note.Content)}, nil
}

func (s *Server) getBacklinks(ctx context.Context, req *mcp.CallToolRequest, in linksIn) (*mcp.CallToolResult, linksOut, error) {
	if in.Path == "" {
		return nil, linksOut{}, errPathRequired
	}
	notes, err := s.markdownNotes(ctx, req, in.Vault)
	if err != nil {
		return nil, linksOut{}, err
	}
	target := noteStem(in.Path)
	out := linksOut{Path: in.Path, Links: make([]string, 0)}
	for _, n := range notes {
		if n.Path == in.Path {
			continue
		}
		for _, l := range extractWikilinks(n.Content) {
			if wikilinkMatches(l, target, in.Path) {
				out.Links = append(out.Links, n.Path)
				break
			}
		}
	}
	return nil, out, nil
}

func (s *Server) findBrokenLinks(ctx context.Context, req *mcp.CallToolRequest, in findBrokenIn) (*mcp.CallToolResult, findBrokenOut, error) {
	notes, err := s.markdownNotes(ctx, req, in.Vault)
	if err != nil {
		return nil, findBrokenOut{}, err
	}
	stems := map[string]struct{}{}
	paths := map[string]struct{}{}
	for _, n := range notes {
		stems[noteStem(n.Path)] = struct{}{}
		paths[n.Path] = struct{}{}
		paths[strings.TrimSuffix(n.Path, path.Ext(n.Path))] = struct{}{}
	}
	out := findBrokenOut{Broken: make([]brokenLink, 0)}
	for _, n := range notes {
		for _, l := range extractWikilinks(n.Content) {
			if _, ok := paths[l]; ok {
				continue
			}
			if _, ok := paths[l+".md"]; ok {
				continue
			}
			if _, ok := stems[noteStem(l)]; ok {
				continue
			}
			out.Broken = append(out.Broken, brokenLink{From: n.Path, To: l})
		}
	}
	return nil, out, nil
}

func (s *Server) findOrphans(ctx context.Context, req *mcp.CallToolRequest, in findOrphansIn) (*mcp.CallToolResult, findOrphansOut, error) {
	notes, err := s.markdownNotes(ctx, req, in.Vault)
	if err != nil {
		return nil, findOrphansOut{}, err
	}
	incoming := map[string]int{}
	for _, n := range notes {
		incoming[n.Path] = 0
	}
	for _, n := range notes {
		for _, l := range extractWikilinks(n.Content) {
			for _, n2 := range notes {
				if wikilinkMatches(l, noteStem(n2.Path), n2.Path) {
					incoming[n2.Path]++
				}
			}
		}
	}
	out := findOrphansOut{Orphans: make([]string, 0)}
	for _, n := range notes {
		if incoming[n.Path] == 0 {
			out.Orphans = append(out.Orphans, n.Path)
		}
	}
	sort.Strings(out.Orphans)
	return nil, out, nil
}

func (s *Server) getVaultStats(ctx context.Context, req *mcp.CallToolRequest, in vaultStatsIn) (*mcp.CallToolResult, vaultStatsOut, error) {
	vid, err := s.requireVault(req, in.Vault)
	if err != nil {
		return nil, vaultStatsOut{}, err
	}
	stats, err := s.repo.Stats(ctx, vid)
	if err != nil {
		return nil, vaultStatsOut{}, err
	}
	notes, err := s.repo.ListAll(ctx, vid, false)
	if err != nil {
		return nil, vaultStatsOut{}, err
	}
	folders := map[string]int{}
	for _, n := range notes {
		dir := path.Dir(n.Path)
		if dir == "." {
			dir = "/"
		}
		folders[dir]++
	}
	out := vaultStatsOut{
		TotalNotes: int(stats.TotalFiles),
		TotalSize:  stats.TotalSize,
		Folders:    make([]folderCount, 0, len(folders)),
		Recent:     make([]recentNote, 0, 10),
	}
	for f, c := range folders {
		out.Folders = append(out.Folders, folderCount{Folder: f, Count: c})
	}
	sort.Slice(out.Folders, func(i, j int) bool { return out.Folders[i].Count > out.Folders[j].Count })
	// ListAll 已按 updated_at DESC
	for i, n := range notes {
		if i >= 10 {
			break
		}
		out.Recent = append(out.Recent, recentNote{Path: n.Path, Mtime: n.Mtime})
	}
	return nil, out, nil
}

// markdownNotes 拉取单 vault 全部 markdown 笔记（跳过附件）。
func (s *Server) markdownNotes(ctx context.Context, req *mcp.CallToolRequest, vault string) ([]model.Note, error) {
	vid, err := s.requireVault(req, vault)
	if err != nil {
		return nil, err
	}
	notes, err := s.repo.ListWithContent(ctx, vid)
	if err != nil {
		return nil, err
	}
	out := make([]model.Note, 0, len(notes))
	for _, n := range notes {
		if repository.IsAttachment(n.Path) {
			continue
		}
		out = append(out, n)
	}
	return out, nil
}

func extractWikilinks(content string) []string {
	matches := reWikilink.FindAllStringSubmatch(content, -1)
	seen := map[string]struct{}{}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		target := strings.TrimSpace(m[1])
		if target == "" {
			continue
		}
		if _, ok := seen[target]; ok {
			continue
		}
		seen[target] = struct{}{}
		out = append(out, target)
	}
	return out
}

func extractTags(content string) []string {
	matches := reTag.FindAllStringSubmatch(content, -1)
	seen := map[string]struct{}{}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		t := m[1]
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

func noteStem(p string) string {
	base := path.Base(p)
	return strings.TrimSuffix(base, path.Ext(base))
}

func wikilinkMatches(link, stem, fullPath string) bool {
	if link == fullPath || link == strings.TrimSuffix(fullPath, path.Ext(fullPath)) {
		return true
	}
	return noteStem(link) == stem
}

var (
	errTagRequired  = errString("tag required")
	errPathRequired = errString("path required")
)

type errString string

func (e errString) Error() string { return string(e) }
