package gitbackup

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"owiki/internal/model"
	"owiki/internal/service"

	"github.com/go-git/go-billy/v5/memfs"
	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/storage/memory"
)

// RestoreDiffItem 远程与 DB 的单文件差异。
type RestoreDiffItem struct {
	Path string `json:"path"`
	// "remote-only"：DB 没有该路径；"differs"：都有但内容不同
	Type    string `json:"type"`
	NoteID  int64  `json:"noteId"`
	DBMtime int64  `json:"dbMtime"` // DB 侧 mtime（毫秒；remote-only 为 0）
	Size    int64  `json:"size"`    // 远程侧文件大小
}

// RestoreDiff 恢复预览：远程 HEAD（或指定 ref）vs DB。
type RestoreDiff struct {
	// Ref 实际对比的 ref（默认目标分支；可指定 owiki/diverged-* 护底分支）
	Ref         string            `json:"ref"`
	RemoteShort string            `json:"remoteShort"`
	Items       []RestoreDiffItem `json:"items"`
	Total       int               `json:"total"`
}

// RestoreApplyResult 恢复应用结果。
type RestoreApplyResult struct {
	Applied int      `json:"applied"`
	Skipped []string `json:"skipped"` // 远程上已不存在的路径
}

// RestoreDiff 计算远程与 DB 的文件级差异。只读：不改工作树、不写 DB。
// 文本精确比对内容；附件（元数据行 Content 为空）一律列为 differs，
// 由用户勾选决定是否覆盖。
func (s *Runner) RestoreDiff(ctx context.Context, cfg *model.VaultGitBackup, restoreFrom string) (*RestoreDiff, error) {
	ref := restoreFrom
	if ref == "" {
		ref = cfg.Branch
	}
	tree, short, err := s.remoteTree(ctx, cfg, ref)
	if err != nil {
		return nil, err
	}

	notes, err := s.notes.ListWithContent(ctx, cfg.VaultID)
	if err != nil {
		return nil, err
	}
	dbPaths := make(map[string]model.Note, len(notes))
	for _, n := range notes {
		dbPaths[n.Path] = n
	}

	items := []RestoreDiffItem{}
	err = tree.Files().ForEach(func(f *object.File) error {
		p := f.Name
		if !restorablePath(p) {
			return nil
		}
		dbNote, inDB := dbPaths[p]
		switch {
		case !inDB:
			items = append(items, RestoreDiffItem{Path: p, Type: "remote-only", Size: f.Size})
		case noteContentDiffers(dbNote, f):
			items = append(items, RestoreDiffItem{
				Path: p, Type: "differs",
				NoteID: dbNote.ID, DBMtime: dbNote.Mtime, Size: f.Size,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	return &RestoreDiff{Ref: ref, RemoteShort: short, Items: items, Total: len(items)}, nil
}

// RestoreApply 把选中的远程文件写回 DB。mode: "all" | "selected"。
// 文本笔记走 service.Save（hash/snapshot/冲突逻辑复用，Force 覆盖）；
// 附件字节直接落 AttachStore 再 upsert 元数据行。
func (s *Runner) RestoreApply(ctx context.Context, cfg *model.VaultGitBackup, restoreFrom, mode string, paths []string) (*RestoreApplyResult, error) {
	tree, _, err := s.remoteTree(ctx, cfg, restoreFromOr(restoreFrom, cfg.Branch))
	if err != nil {
		return nil, err
	}

	apply := map[string]bool{}
	if mode == "all" {
		diff, err := s.RestoreDiff(ctx, cfg, restoreFrom)
		if err != nil {
			return nil, err
		}
		for _, it := range diff.Items {
			apply[it.Path] = true
		}
	} else {
		for _, p := range paths {
			apply[p] = true
		}
	}

	res := &RestoreApplyResult{Skipped: []string{}}
	for p := range apply {
		f, err := tree.File(p)
		if err != nil {
			res.Skipped = append(res.Skipped, p) // 远程不存在
			continue
		}
		rd, err := f.Blob.Reader()
		if err != nil {
			res.Skipped = append(res.Skipped, p)
			continue
		}
		data, readErr := io.ReadAll(rd)
		_ = rd.Close()
		if readErr != nil {
			res.Skipped = append(res.Skipped, p)
			continue
		}

		if isTextPath(p) {
			// 走统一写入路径：hash/snapshot/事件齐全，Force 覆盖 DB 版本。
			// git blob 无修改时间，mtime 取当前时间。
			if _, err := service.Save(ctx, s.notes, service.SaveInput{
				VaultID: cfg.VaultID,
				Path:    p,
				Content: string(data),
				Mtime:   time.Now().UnixMilli(),
				Force:   true,
			}); err != nil {
				return res, fmt.Errorf("restore %s: %w", p, err)
			}
		} else {
			if _, err := s.attach.Save(cfg.VaultID, p, base64.StdEncoding.EncodeToString(data)); err != nil {
				return res, fmt.Errorf("restore attachment %s: %w", p, err)
			}
		}
		res.Applied++
	}
	return res, nil
}

// remoteTree clone 指定 ref（depth=1，内存），返回根 tree 与短 SHA。不落盘。
func (s *Runner) remoteTree(ctx context.Context, cfg *model.VaultGitBackup, ref string) (*object.Tree, string, error) {
	mst := memory.NewStorage()
	repo, err := git.Clone(mst, memfs.New(), &git.CloneOptions{
		URL:           cfg.RemoteURL,
		Auth:          basicAuth(cfg.Token),
		Depth:         1,
		SingleBranch:  true,
		ReferenceName: plumbing.NewBranchReferenceName(ref),
	})
	if err != nil {
		return nil, "", fmt.Errorf("clone %s: %s", ref, sanitizeErr(err))
	}
	head, err := repo.Head()
	if err != nil {
		return nil, "", err
	}
	c, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, "", err
	}
	tree, err := c.Tree()
	if err != nil {
		return nil, "", err
	}
	return tree, shortSHA(head.Hash()), nil
}

// restorablePath 恢复导入只处理笔记与附件路径，跳过 .obsidian 等配置目录。
func restorablePath(p string) bool {
	if strings.HasPrefix(p, ".obsidian/") || p == ".gitignore" || p == ".gitattributes" {
		return false
	}
	return true
}

// isTextPath 文本类路径按笔记写回；其余按附件处理。
func isTextPath(p string) bool {
	switch strings.ToLower(path.Ext(p)) {
	case ".md", ".markdown", ".txt", ".json", ".canvas", ".csv":
		return true
	}
	return false
}

// noteContentDiffers DB 笔记与远程文件内容是否不同。
// 附件元数据行 Content 为空串：无法便宜判同，一律 true 交用户勾选。
// 文本先按长度预筛，长度相同再读 blob 精确比对。
func noteContentDiffers(n model.Note, f *object.File) bool {
	if n.Content == "" {
		return true
	}
	if int64(len(n.Content)) != f.Size {
		return true
	}
	rc, err := f.Blob.Reader()
	if err != nil {
		return true // 读不了当不同
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return true
	}
	return string(data) != n.Content
}

func restoreFromOr(from, def string) string {
	if from != "" {
		return from
	}
	return def
}
