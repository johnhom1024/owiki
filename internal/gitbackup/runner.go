package gitbackup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
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

// Run 跑一轮完整备份：物化 → commit（如有变更）→ push。
// 状态干净也走 push：幂等探测远程（远程被外部改写时借机自愈）。
func (s *Runner) Run(ctx context.Context, cfg *model.VaultGitBackup) (*RunResult, error) {
	return s.run(ctx, cfg, true)
}

// allowRebuild=false 时分叉不再重建（防递归失控），直接报错。
func (s *Runner) run(ctx context.Context, cfg *model.VaultGitBackup, allowRebuild bool) (*RunResult, error) {
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

	// 1.5) 远程非空时的基底对接：把远程目标分支 fetch 下来并设为本地祖先。
	// 场景：用户在 GitHub 建仓时勾了 README/.gitignore，首推即 non-fast-forward。
	// 策略：本地还没有任何 commit 时，直接把远程分支 fetch 进来当基底（历史保留，
	// 之后物化提交在它之上，push 永远 fast-forward）；本地已有 commit 则基底
	// 已定、永不改写——与远程的分叉交给 push 阶段的自愈。
	if cfg.RemoteURL != "" {
		if err := s.adoptRemoteBase(ctx, repo, cfg); err != nil {
			return nil, err
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

	res := &RunResult{Files: files}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("git status: %w", err)
	}
	if !status.IsClean() {
		// 4) commit（有变更才提交）
		sig := &object.Signature{Name: "owiki gitbackup", Email: "gitbackup@owiki.local", When: time.Now()}
		commit, err := wt.Commit(commitPrefix, &git.CommitOptions{Author: sig})
		if err != nil {
			return nil, fmt.Errorf("git commit: %w", err)
		}
		res.Committed = true
		res.CommitSHA = shortSHA(commit)
	} else {
		sha, _ := headShortSHA(repo)
		res.CommitSHA = sha
	}

	// 5) push（无论本轮是否产生新 commit：干净也推一次，幂等且探测远程）
	if cfg.RemoteURL == "" {
		// 未配置远程：本地 commit 保留，等配置后再推
		return res, nil
	}
	if err := push(ctx, repo, cfg); err != nil {
		// 分叉自愈：本地工作树只是缓存，与远程不同源（换了 remote / 远程被重建）
		// 时删掉重建，以远程为基底重新物化——绝不 force push，DB 是唯一真相。
		if errors.Is(err, errDiverged) && allowRebuild {
			// 护底分支（方案 A）：重建会覆盖远程 HEAD（物化清掉 DB 外文件），
			// 覆盖前把远程当前 HEAD 存进 owiki/diverged-<时间戳> 保护分支——
			// best effort，失败只记日志不阻断自愈（历史仍在远程对象库里）。
			if keepErr := s.protectDivergedRemote(ctx, repo, cfg); keepErr != nil {
				log.Printf("[gitbackup] vault=%d keep diverged backup ref failed: %v", cfg.VaultID, keepErr)
			}
			log.Printf("[gitbackup] vault=%d diverged from remote, rebuilding worktree from remote base", cfg.VaultID)
			if rmErr := s.RemoveWorktree(cfg.VaultID); rmErr != nil {
				return res, fmt.Errorf("rebuild cleanup: %w", rmErr)
			}
			res2, err2 := s.run(ctx, cfg, false) // 重建后只许成功，不再递归
			if err2 != nil {
				return res2, err2
			}
			res2.Files += res.Files
			return res2, nil
		}
		res.Pushed = false
		return res, fmt.Errorf("push: %w", err)
	}
	res.Pushed = true
	return res, nil
}

// protectDivergedRemote 分叉自愈的护底（方案 A）：覆盖远程前，把远程当前
// 分支 HEAD 推到 owiki/diverged-<时间戳> 保护分支，被冲掉的内容显眼可寻。
// best effort：任何失败只记日志，不阻断自愈。
func (s *Runner) protectDivergedRemote(ctx context.Context, repo *git.Repository, cfg *model.VaultGitBackup) error {
	remoteRef := fmt.Sprintf("refs/heads/%s", cfg.Branch)
	remoteHead, err := fetchRemoteRef(ctx, repo, cfg, remoteRef)
	if err != nil || remoteHead == "" {
		return fmt.Errorf("fetch remote head: %v", err)
	}
	const remoteName = "origin"
	_ = repo.DeleteRemote(remoteName)
	if _, err := repo.CreateRemote(&config.RemoteConfig{
		Name: remoteName,
		URLs: []string{cfg.RemoteURL},
	}); err != nil {
		return fmt.Errorf("create remote: %w", err)
	}
	backupRef := fmt.Sprintf("owiki/diverged-%s", time.Now().Format("20060102-150405"))
	err = repo.PushContext(ctx, &git.PushOptions{
		RemoteName: remoteName,
		Auth:       basicAuth(cfg.Token),
		// 远程 HEAD hash → 保护分支（远程已有对象，零传输）
		RefSpecs: []config.RefSpec{config.RefSpec(fmt.Sprintf(
			"%s:refs/heads/%s", remoteHead, backupRef))},
	})
	if err != nil && !strings.Contains(err.Error(), "already up-to-date") {
		return err
	}
	log.Printf("[gitbackup] vault=%d diverged remote HEAD %s kept at branch %s",
		cfg.VaultID, shortSHA(plumbing.NewHash(remoteHead)), backupRef)
	return nil
}

// adoptRemoteBase 远程非空时的基底对接（见 Run 步骤 1.5 的注释）。
// 幂等：只在工作树仓库没有任何 commit 时 fetch 并合入基底；之后轮次直接跳过。
func (s *Runner) adoptRemoteBase(ctx context.Context, repo *git.Repository, cfg *model.VaultGitBackup) error {
	// 空仓库判据：HEAD 解析不出 commit（刚 init，refs/heads/<branch> 还不存在）。
	// 注意不能用 headShortSHA——它对空仓库返回 ("", nil)，err 恒为 nil 会误判。
	if _, err := repo.Head(); err == nil {
		return nil // 本地已有 commit：基底已定，永不改写
	}

	remoteRef := fmt.Sprintf("refs/heads/%s", cfg.Branch)
	base, err := fetchRemoteRef(ctx, repo, cfg, remoteRef)
	if err != nil {
		return fmt.Errorf("fetch remote base: %w", err)
	}
	if base == "" {
		return nil // 远程是空仓库：无需基底
	}

	// 把远程 HEAD 设为本地分支指向（祖先），物化的变更会在其上提交
	if err := repo.Storer.SetReference(plumbing.NewReferenceFromStrings(
		"refs/heads/"+cfg.Branch, base,
	)); err != nil {
		return fmt.Errorf("set base branch: %w", err)
	}
	// HEAD 保持指向本地分支；checkout 基底内容到工作树。
	// 用 Hash 直接 checkout（不用 Branch）——此刻 refs/heads/<branch> 刚被
	// SetReference 指向基底 hash，Hash checkout 等价且绕开 go-git 对「分支
	// 已存在」的校验差异；不传 Keep——工作树是一次性缓存，基底内容应当真实
	// 落盘（物化对账会把 DB 外的文件清掉，但基底文件必须先进工作树才能被
	// git 追踪为删除）。
	wt, err := repo.Worktree()
	if err != nil {
		return fmt.Errorf("worktree: %w", err)
	}
	if err := wt.Checkout(&git.CheckoutOptions{
		Hash:   plumbing.NewHash(base),
		Branch: plumbing.ReferenceName(""),
		Keep:   false,
	}); err != nil {
		return fmt.Errorf("checkout base: %w", err)
	}
	// HEAD 符号引用指回本地分支（checkout Hash 会把 HEAD 变 detached）
	if err := repo.Storer.SetReference(plumbing.NewSymbolicReference(
		plumbing.HEAD, plumbing.NewBranchReferenceName(cfg.Branch),
	)); err != nil {
		return fmt.Errorf("restore HEAD: %w", err)
	}
	return nil
}

// fetchRemoteRef 从远程拉取目标分支，返回其 HEAD hash（远程无此分支时空串）。
// 同时把对象存进本地对象库，供 adoptRemoteBase 设基底与后续三方对比用。
func fetchRemoteRef(ctx context.Context, repo *git.Repository, cfg *model.VaultGitBackup, remoteRef string) (string, error) {
	const remoteName = "origin"
	_ = repo.DeleteRemote(remoteName)
	if _, err := repo.CreateRemote(&config.RemoteConfig{
		Name: remoteName,
		URLs: []string{cfg.RemoteURL},
	}); err != nil {
		return "", fmt.Errorf("create remote: %w", err)
	}
	var auth transport.AuthMethod
	if cfg.Token != "" {
		auth = &http.BasicAuth{Username: "owiki", Password: cfg.Token}
	}
	err := repo.FetchContext(ctx, &git.FetchOptions{
		RemoteName: remoteName,
		Auth:       auth,
		// Force：分叉自愈/护底时 refs/remotes/origin/<branch> 已存在且指向
		// 别的 commit（非 fast-forward），不强推更新会被拒 "some refs not updated"。
		Force: true,
		RefSpecs: []config.RefSpec{
			config.RefSpec(fmt.Sprintf("%s:refs/remotes/origin/%s", remoteRef, cfg.Branch)),
		},
	})
	if err != nil {
		if errors.Is(err, git.NoErrAlreadyUpToDate) || errors.Is(err, transport.ErrEmptyRemoteRepository) {
			return "", nil // 空仓库：无基底
		}
		return "", err
	}
	ref, err := repo.Reference(plumbing.ReferenceName(
		fmt.Sprintf("refs/remotes/origin/%s", cfg.Branch)), true)
	if err != nil {
		return "", nil // 远程没有目标分支：视为无基底
	}
	return ref.Hash().String(), nil
}

// push 推送到远程。绝不 force push；远程领先/分叉时返回 errDiverged 交上层自愈。
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

	refSpec := fmt.Sprintf("refs/heads/%s:refs/heads/%s", cfg.Branch, cfg.Branch)
	err := repo.PushContext(ctx, &git.PushOptions{
		RemoteName:    remoteName,
		Auth:          basicAuth(cfg.Token),
		RefSpecs:      []config.RefSpec{config.RefSpec(refSpec)},
		Force:         false,
	})
	if err != nil && (errors.Is(err, git.NoErrAlreadyUpToDate) || strings.Contains(err.Error(), "already up-to-date")) {
		// 远程已有同一 commit（重复推）：视为成功
		return nil
	}
	if err != nil && strings.Contains(err.Error(), "non-fast-forward") {
		// 远程有本地没有的 commit（分叉或被外部推进）：自愈信号
		return errDiverged
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
