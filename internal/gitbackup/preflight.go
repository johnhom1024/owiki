package gitbackup

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/go-git/go-billy/v5/memfs"
	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/go-git/go-git/v5/storage/memory"
)

// commitPrefix owiki 备份 commit 的固定前缀（preflight 据此识别「自己人」历史，
// Runner.Run 的 commit message 必须与此保持一致）。
const commitPrefix = "backup: sync from owiki"

// preflight 状态分类。
const (
	PreflightEmpty       = "empty"       // 远程没有任何 commit（全新仓库）
	PreflightOwiki       = "owiki"       // 目标分支最新 commit 是 owiki 产生的——之前同步过，无缝续接
	PreflightForeign     = "foreign"     // 目标分支有陌生 commit——开启需用户确认后果
	PreflightNoBranch    = "no-branch"   // 远程有 commit 但没有目标分支——推新分支，天然 fast-forward
	PreflightUnreachable = "unreachable" // 网络/认证/仓库不存在
)

// PreflightResult 开启备份前的远程探测结果。
type PreflightResult struct {
	Status      string `json:"status"`
	HeadShort   string `json:"headShort"`
	LastMessage string `json:"lastMessage"`
	Detail      string `json:"detail"`
}

// Preflight 探测远程仓库状态。全程内存（ls-remote + depth=1 memory clone），
// 不落盘、不碰本地工作树。token 传空串表示匿名访问（公开仓库探测）。
func (s *Runner) Preflight(ctx context.Context, remoteURL, token, branch string) PreflightResult {
	if branch == "" {
		branch = "main"
	}

	// 1) ls-remote：拿分支列表（不下载对象）
	st := memory.NewStorage()
	remote := git.NewRemote(st, &config.RemoteConfig{Name: "origin", URLs: []string{remoteURL}})
	refs, err := remote.ListContext(ctx, &git.ListOptions{Auth: basicAuth(token)})
	if err != nil {
		// 空仓库的 ls-remote 在 file:// 下报 "remote repository is empty"
		// （HTTP 服务通常回零引用列表而非错误）——归为 empty 而非不可达。
		if strings.Contains(err.Error(), "empty") {
			return PreflightResult{Status: PreflightEmpty}
		}
		return PreflightResult{
			Status:  PreflightUnreachable,
			Detail:  sanitizeErr(fmt.Errorf("ls-remote: %w", err)),
		}
	}

	// 有没有目标分支？
	target := plumbing.NewBranchReferenceName(branch)
	hasBranch := false
	hasAnyCommit := false
	for _, r := range refs {
		if r.Name() == target {
			hasBranch = true
		}
		if r.Type() == plumbing.HashReference {
			hasAnyCommit = true
		}
	}
	if !hasAnyCommit {
		return PreflightResult{Status: PreflightEmpty}
	}
	if !hasBranch {
		return PreflightResult{
			Status: PreflightNoBranch,
			Detail: fmt.Sprintf("remote has commits but no branch %q; a new branch will be created", branch),
		}
	}

	// 2) depth=1 memory clone 目标分支，看最新 commit 是谁产生的
	mst := memory.NewStorage()
	repo, err := git.Clone(mst, memfs.New(), &git.CloneOptions{
		URL:           remoteURL,
		Auth:          basicAuth(token),
		Depth:         1,
		SingleBranch:  true,
		ReferenceName: target,
	})
	if err != nil {
		return PreflightResult{
			Status:  PreflightUnreachable,
			Detail:  sanitizeErr(fmt.Errorf("probe: %w", err)),
		}
	}
	head, err := repo.Head()
	if err != nil {
		return PreflightResult{Status: PreflightUnreachable, Detail: "no head after clone"}
	}
	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return PreflightResult{Status: PreflightUnreachable, Detail: "head is not a commit"}
	}

	firstLine := strings.SplitN(strings.TrimSpace(commit.Message), "\n", 2)[0]
	res := PreflightResult{HeadShort: shortSHA(commit.Hash), LastMessage: firstLine}
	if strings.HasPrefix(firstLine, commitPrefix) {
		res.Status = PreflightOwiki
	} else {
		res.Status = PreflightForeign
	}
	return res
}

// basicAuth token → HTTP Basic 认证（token 是唯一凭证，username 任意）。
func basicAuth(token string) transport.AuthMethod {
	if token == "" {
		return nil
	}
	return &http.BasicAuth{Username: "owiki", Password: token}
}

var errDiverged = errors.New("remote history diverged from local worktree")
