package gitbackup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// seedFileRemote 建一个带初始 commit 的 file:// bare 远程（系统 git 建，行为最标准）。
// 返回远程 URL 与初始 commit hash。
func seedFileRemote(t *testing.T, msg, file, content string) (string, plumbing.Hash) {
	t.Helper()
	dir := t.TempDir()
	wt := filepath.Join(dir, "seed")
	if _, err := git.PlainInitWithOptions(wt, &git.PlainInitOptions{
		InitOptions: git.InitOptions{DefaultBranch: plumbing.NewBranchReferenceName("main")},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wt, file), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	r, _ := git.PlainOpen(wt)
	w, _ := r.Worktree()
	_, _ = w.Add(file)
	h, err := w.Commit(msg, &git.CommitOptions{
		Author: &object.Signature{Name: "seed", Email: "seed@test", When: time.Now()},
	})
	if err != nil {
		t.Fatal(err)
	}
	bare := filepath.Join(dir, "remote.git")
	if err := os.MkdirAll(bare, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "clone", "--bare", "-q", wt, bare).CombinedOutput(); err != nil {
		t.Fatalf("bare clone: %v %s", err, out)
	}
	return "file://" + bare, h
}

func TestPreflightEmpty(t *testing.T) {
	_, _, runner := newTestDeps(t)
	dir := t.TempDir()
	bare := filepath.Join(dir, "empty.git")
	if err := os.MkdirAll(bare, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "init", "--bare", "-b", "main", bare).CombinedOutput(); err != nil {
		t.Fatalf("init bare: %v %s", err, out)
	}
	res := runner.Preflight(context.Background(), "file://"+bare, "", "main")
	if res.Status != PreflightEmpty {
		t.Fatalf("want empty, got %+v", res)
	}
}

func TestPreflightOwikiHistory(t *testing.T) {
	_, _, runner := newTestDeps(t)
	url, _ := seedFileRemote(t, "backup: sync from owiki", "note.md", "old snapshot")
	res := runner.Preflight(context.Background(), url, "", "main")
	if res.Status != PreflightOwiki {
		t.Fatalf("want owiki, got %+v", res)
	}
	if res.LastMessage != "backup: sync from owiki" {
		t.Fatalf("lastMessage = %q", res.LastMessage)
	}
}

func TestPreflightForeignHistory(t *testing.T) {
	_, _, runner := newTestDeps(t)
	url, _ := seedFileRemote(t, "Initial commit", "README.md", "# seeded")
	res := runner.Preflight(context.Background(), url, "", "main")
	if res.Status != PreflightForeign {
		t.Fatalf("want foreign, got %+v", res)
	}
	if res.HeadShort == "" {
		t.Fatal("headShort should be set for foreign")
	}
}

func TestPreflightUnreachable(t *testing.T) {
	_, _, runner := newTestDeps(t)
	res := runner.Preflight(context.Background(), "file:///nonexistent/path/repo.git", "", "main")
	if res.Status != PreflightUnreachable {
		t.Fatalf("want unreachable, got %+v", res)
	}
}

// 分叉自愈：本地推过 A 远程；换到全新 B 远程（有陌生历史）→ 首推 non-fast-forward
// → 自动重建工作树以 B 为基底 → push 成功，B 的历史保留。
func TestRunnerDivergenceSelfHeal(t *testing.T) {
	notes, err := repository.NewNoteRepo(filepath.Join(t.TempDir(), "n.db"))
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(t.TempDir(), "att"))
	if err != nil {
		t.Fatal(err)
	}
	runner, err := NewRunner(notes, attach, filepath.Join(t.TempDir(), "gb"))
	if err != nil {
		t.Fatal(err)
	}
	upsertNote(t, notes, 11, "heal.md", "v1")

	// A 远程（owiki 自己的历史）
	urlA, _ := seedFileRemote(t, "backup: sync from owiki", "heal.md", "old")
	cfg := &model.VaultGitBackup{VaultID: 11, Branch: "main", Enabled: true, RemoteURL: urlA}
	if _, err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatalf("first run on A: %v", err)
	}

	// 换到 B 远程（陌生历史）
	urlB, _ := seedFileRemote(t, "foreign: rewritten history", "other.md", "x")
	cfg.RemoteURL = urlB
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatalf("run with diverged remote: %v", err)
	}
	if !res.Pushed {
		t.Fatalf("self-heal should push: %+v", res)
	}

	// B 的初始 commit 仍在历史里，heal.md 已推上
	bareDir := strings.TrimPrefix(urlB, "file://")
	rr, err := git.PlainOpen(bareDir)
	if err != nil {
		t.Fatal(err)
	}
	head, err := rr.Head()
	if err != nil {
		t.Fatal(err)
	}
	c, err := rr.CommitObject(head.Hash())
	if err != nil {
		t.Fatal(err)
	}
	tree, err := c.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tree.File("heal.md"); err != nil {
		t.Fatal("heal.md should be on B after self-heal")
	}
	if _, err := tree.File("other.md"); err == nil {
		t.Fatal("foreign file should be materialized away from HEAD")
	}
	parent, err := c.Parent(0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(parent.Message, "foreign: rewritten history") {
		t.Fatalf("parent should be foreign initial commit, got %q", parent.Message)
	}
}
