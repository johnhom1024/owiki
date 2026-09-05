package gitbackup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
)

// Runner 物化 + commit + push 的执行器（每 vault 一个，串行调用）。
// 工作树是一次性缓存：DB 是唯一真相，物化时按 DB 全量对账（写新/改写/删缺失），
// 目录损坏时直接删掉重建，不做部分恢复。
type Runner struct {
	// notes 笔记仓库（DB）
	notes *repository.NoteRepo
	// attach 附件存储（磁盘）
	attach *repository.AttachStore
	// root 全部工作树的父目录（<data>/gitbackup/）
	root string
}

func NewRunner(notes *repository.NoteRepo, attach *repository.AttachStore, root string) (*Runner, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Runner{notes: notes, attach: attach, root: root}, nil
}

// worktreePath 单个 vault 的工作树目录（<root>/<vaultID>）。
func (s *Runner) worktreePath(vaultID int64) string {
	return filepath.Join(s.root, fmt.Sprint(vaultID))
}

// RemoveWorktree vault 删除时清理工作树目录。
func (s *Runner) RemoveWorktree(vaultID int64) error {
	return os.RemoveAll(s.worktreePath(vaultID))
}

// RunResult 一轮备份的结果。
type RunResult struct {
	// Committed 是否产生了新 commit（无变更时 false，跳过 push）
	Committed bool
	// CommitSHA 新 commit 的短 SHA（Committed=false 时为最近一次 commit）
	CommitSHA string
	// Pushed push 是否成功（远程不可达时 false，本地 commit 不丢）
	Pushed bool
	// Files 物化阶段变更的文件数（增/删/改）
	Files int
}

// Run 跑一轮完整备份：物化 → commit → push。
// cfg.Enabled=false 时防御性跳过（调用方也应过滤）。
// 返回的 error 信息不含 token（凭据只进 git 传输层）。
func (s *Runner) Run(ctx context.Context, cfg *model.VaultGitBackup) (*RunResult, error) {
	wtDir := s.worktreePath(cfg.VaultID)

	// 1) 打开或初始化仓库
	repo, err := git.PlainOpen(wtDir)
	if err != nil {
		if !errors.Is(err, git.ErrRepositoryNotExists) {
			return nil, fmt.Errorf("open repo: %w", err)
		}
		// 全新：init（HEAD 指向配置的目标分支——go-git 默认 master，
		// 不显式指定的话空 remote 收到 main 会被判 "remote not found"）
		repo, err = git.PlainInitWithOptions(wtDir, &git.PlainInitOptions{
			Bare: false,
			InitOptions: git.InitOptions{
				DefaultBranch: plumbing.NewBranchReferenceName(cfg.Branch),
			},
		})
		if err != nil {
			return nil, fmt.Errorf("init repo: %w", err)
		}
	}

	// 2) 物化：按 DB 全量对账工作树
	files, err := s.materialize(ctx, cfg.VaultID, wtDir)
	if err != nil {
		return nil, fmt.Errorf("materialize: %w", err)
	}

	wt, err := repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("worktree: %w", err)
	}

	// 3) add 全部（含删除）
	if err := wt.AddWithOptions(&git.AddOptions{All: true}); err != nil {
		return nil, fmt.Errorf("git add: %w", err)
	}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("git status: %w", err)
	}
	if status.IsClean() {
		// 无变更：不 commit 不 push，只更新 lastRunAt
		sha, _ := headShortSHA(repo)
		return &RunResult{CommitSHA: sha}, nil
	}

	// 4) commit
	sig := &object.Signature{Name: "owiki gitbackup", Email: "gitbackup@owiki.local", When: time.Now()}
	commit, err := wt.Commit("backup: sync from owiki", &git.CommitOptions{Author: sig})
	if err != nil {
		return nil, fmt.Errorf("git commit: %w", err)
	}

	res := &RunResult{Committed: true, CommitSHA: shortSHA(commit), Files: files}

	// 5) push（失败不回滚 commit：write-behind，下轮重试）
	if cfg.RemoteURL == "" {
		// 未配置远程：本地 commit 保留，等配置后再推
		return res, nil
	}
	if err := push(ctx, repo, cfg); err != nil {
		res.Pushed = false
		return res, fmt.Errorf("push: %w", err)
	}
	res.Pushed = true
	return res, nil
}

// push 推送到远程。非 fast-forward（远程被外部改动）时返回错误，绝不 force push。
func push(ctx context.Context, repo *git.Repository, cfg *model.VaultGitBackup) error {
	// PushContext 默认查名为 origin 的 remote 配置；不 CreateRemote 会报
	// ErrRemoteNotFound。每次 UPSERT（URL 变了也同步）。
	const remoteName = "origin"
	_ = repo.DeleteRemote(remoteName)
	if _, err := repo.CreateRemote(&config.RemoteConfig{
		Name: remoteName,
		URLs: []string{cfg.RemoteURL},
	}); err != nil {
		return fmt.Errorf("create remote: %w", err)
	}

	var auth transport.AuthMethod
	if cfg.Token != "" {
		auth = &http.BasicAuth{Username: "owiki", Password: cfg.Token}
	}
	refSpec := fmt.Sprintf("refs/heads/%s:refs/heads/%s", cfg.Branch, cfg.Branch)
	err := repo.PushContext(ctx, &git.PushOptions{
		RemoteName:    remoteName,
		Auth:          auth,
		RefSpecs:      []config.RefSpec{config.RefSpec(refSpec)},
		Force:         false,
	})
	if err != nil && (errors.Is(err, git.NoErrAlreadyUpToDate) || strings.Contains(err.Error(), "already up-to-date")) {
		// 远程已有同一 commit（重复推）：视为成功
		return nil
	}
	return err
}

// materialize 把 DB 里的全部笔记 + 附件写到工作树，删除 DB 中已不存在的文件。
// 返回变更文件数。已存在且内容一致的文件跳过写盘。
func (s *Runner) materialize(ctx context.Context, vaultID int64, dir string) (int, error) {
	notes, err := s.notes.ListWithContent(ctx, vaultID)
	if err != nil {
		return 0, err
	}

	// DB 里的全部合法路径（含附件元数据行）
	want := make(map[string]struct{}, len(notes))
	for _, n := range notes {
		want[n.Path] = struct{}{}
	}

	changed := 0
	// 1) 写入/更新
	for _, n := range notes {
		rel := filepath.FromSlash(n.Path)
		dst := filepath.Join(dir, rel)
		if repository.IsAttachment(n.Path) {
			// 附件：从 AttachStore 拷贝字节
			data, err := s.attach.LoadBytes(vaultID, n.Path)
			if err != nil {
				// 附件文件缺失（曾被手动删除）：跳过，下轮再试
				continue
			}
			existing, err := os.ReadFile(dst)
			if err == nil && bytes.Equal(existing, data) {
				continue
			}
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return 0, err
			}
			if err := os.WriteFile(dst, data, 0o644); err != nil {
				return 0, err
			}
			changed++
		} else {
			// 文本笔记：Content 即全文
			existing, err := os.ReadFile(dst)
			if err == nil && string(existing) == n.Content {
				continue
			}
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return 0, err
			}
			if err := os.WriteFile(dst, []byte(n.Content), 0o644); err != nil {
				return 0, err
			}
			changed++
		}
	}

	// 2) 删除 DB 中已不存在的文件（目录遍历，跳过 .git）
	existingPaths, err := walkWorktree(dir)
	if err != nil {
		return 0, err
	}
	for _, rel := range existingPaths {
		if _, ok := want[filepath.ToSlash(rel)]; !ok {
			if err := os.Remove(filepath.Join(dir, rel)); err != nil {
				return 0, err
			}
			changed++
		}
	}
	return changed, nil
}

// walkWorktree 列出工作树内全部文件（相对路径，跳过 .git）。
func walkWorktree(dir string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		out = append(out, rel)
		return nil
	})
	return out, err
}

func shortSHA(h plumbing.Hash) string {
	s := h.String()
	if len(s) > 12 {
		return s[:12]
	}
	return s
}

func headShortSHA(repo *git.Repository) (string, error) {
	head, err := repo.Head()
	if err != nil {
		return "", nil // 空仓库
	}
	return shortSHA(head.Hash()), nil
}
