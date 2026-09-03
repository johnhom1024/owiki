package tools

import (
	"context"
	"path"
	"regexp"
	"sort"
	"strings"
)

var (
	reWikilink = regexp.MustCompile(`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]`)
	reTag      = regexp.MustCompile(`(?:^|[^#\p{L}\p{N}_])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)`)
)

func (h *Host) listTags(ctx context.Context, s *Session, in listTagsIn) (listTagsOut, error) {
	notes, err := h.markdownNotes(ctx, s, in.Vault)
	if err != nil {
		return listTagsOut{}, err
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
	return out, nil
}

func (h *Host) findByTag(ctx context.Context, s *Session, in findByTagIn) (findByTagOut, error) {
	if in.Tag == "" {
		return findByTagOut{}, ErrTagRequired
	}
	tag := strings.TrimPrefix(in.Tag, "#")
	notes, err := h.markdownNotes(ctx, s, in.Vault)
	if err != nil {
		return findByTagOut{}, err
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
	return out, nil
}

func (h *Host) getOutlinks(ctx context.Context, s *Session, in linksIn) (linksOut, error) {
	if in.Path == "" {
		return linksOut{}, ErrPathRequired
	}
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return linksOut{}, err
	}
	note, err := h.Repo.GetByPath(ctx, vid, in.Path)
	if err != nil {
		return linksOut{}, err
	}
	return linksOut{Path: note.Path, Links: extractWikilinks(note.Content)}, nil
}

func (h *Host) getBacklinks(ctx context.Context, s *Session, in linksIn) (linksOut, error) {
	if in.Path == "" {
		return linksOut{}, ErrPathRequired
	}
	notes, err := h.markdownNotes(ctx, s, in.Vault)
	if err != nil {
		return linksOut{}, err
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
	return out, nil
}

func (h *Host) findBrokenLinks(ctx context.Context, s *Session, in findBrokenIn) (findBrokenOut, error) {
	notes, err := h.markdownNotes(ctx, s, in.Vault)
	if err != nil {
		return findBrokenOut{}, err
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
	return out, nil
}

func (h *Host) findOrphans(ctx context.Context, s *Session, in findOrphansIn) (findOrphansOut, error) {
	notes, err := h.markdownNotes(ctx, s, in.Vault)
	if err != nil {
		return findOrphansOut{}, err
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
	return out, nil
}

func (h *Host) getVaultStats(ctx context.Context, s *Session, in vaultStatsIn) (vaultStatsOut, error) {
	vid, err := h.RequireVault(ctx, s, in.Vault)
	if err != nil {
		return vaultStatsOut{}, err
	}
	stats, err := h.Repo.Stats(ctx, vid)
	if err != nil {
		return vaultStatsOut{}, err
	}
	notes, err := h.Repo.ListAll(ctx, vid, false)
	if err != nil {
		return vaultStatsOut{}, err
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
	for i, n := range notes {
		if i >= 10 {
			break
		}
		out.Recent = append(out.Recent, recentNote{Path: n.Path, Mtime: n.Mtime})
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
