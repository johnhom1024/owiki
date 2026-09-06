package gitbackup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

// newRestoreDeps 恢复测试依赖：NoteRepo + AttachStore + Runner + 空 bare 远程。
func newRestoreDeps(t *testing.T) (*repository.NoteRepo, *repository.AttachStore, *Runner, string) {
	t.Helper()
	dir := t.TempDir()
	notes, err := repository.NewNoteRepo(filepath.Join(dir, "n.db"))
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(dir, "att"))
	if err != nil {
		t.Fatal(err)
	}
	runner, err := NewRunner(notes, attach, filepath.Join(dir, "gb"))
	if err != nil {
		t.Fatal(err)
	}
	return notes, attach, runner, newBareRemote(t)
}

// newBareRemote 建一个空 bare 远程，返回 URL。
func newBareRemote(t *testing.T) string {
	t.Helper()
	bare := filepath.Join(t.TempDir(), "remote.git")
	if err := os.MkdirAll(bare, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "init", "--bare", "-b", "main", bare).CombinedOutput(); err != nil {
		t.Fatalf("init bare: %v %s", err, out)
	}
	return "file://" + bare
}

// commitFileToRemote 向 bare 远程推一个新 commit（系统 git 客户端，最标准）。
// files: path -> content；msg：commit message。
// 所有 git 命令必须 -C 指定目录：exec.Command 不设 Dir 时跑在测试进程 CWD
// （源码 worktree）里，add -A 会把源码误提交进分支！
func commitFileToRemote(t *testing.T, remoteURL, msg string, files map[string]string, deletions []string) {
	t.Helper()
	dir := t.TempDir()
	if out, err := exec.Command("git", "clone", "-q", "--config", "init.defaultBranch=main", remoteURL, dir).CombinedOutput(); err != nil {
		t.Fatalf("clone: %v %s", err, out)
	}
	for p, c := range files {
		full := filepath.Join(dir, p)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range deletions {
		if err := os.Remove(filepath.Join(dir, p)); err != nil {
			t.Fatal(err)
		}
	}
	steps := [][]string{
		{"git", "-C", dir, "add", "-A"},
		{"git", "-C", dir, "-c", "user.name=seed", "-c", "user.email=s@x", "commit", "-m", msg},
		{"git", "-C", dir, "push", "-q", "origin", "HEAD:main"},
	}
	for _, cmd := range steps {
		if out, err := exec.Command(cmd[0], cmd[1:]...).CombinedOutput(); err != nil {
			t.Fatalf("%v: %v %s", cmd, err, out)
		}
	}
}

func restoreCfg(vaultID int64, url string) *model.VaultGitBackup {
	return &model.VaultGitBackup{VaultID: vaultID, Branch: "main", Enabled: true, RemoteURL: url}
}

// findDivergedRef 在 bare 远程里找 owiki/diverged-* 分支名（不带 refs/heads/ 前缀）。
func findDivergedRef(t *testing.T, url string) string {
	t.Helper()
	bareDir := strings.TrimPrefix(url, "file://")
	rr, err := git.PlainOpen(bareDir)
	if err != nil {
		t.Fatal(err)
	}
	refs, _ := rr.References()
	var found string
	_ = refs.ForEach(func(r *plumbing.Reference) error {
		name := r.Name().String()
		if strings.HasPrefix(name, "refs/heads/owiki/diverged-") {
			found = strings.TrimPrefix(name, "refs/heads/")
		}
		return nil
	})
	return found
}

// 护底分支（方案 A）：分叉自愈覆盖远程前，远程 HEAD 被存进
// owiki/diverged-<时间戳> 保护分支——被冲掉的文件可从该分支找回。
func TestRunnerDivergenceKeepsBackupRef(t *testing.T) {
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
	upsertNote(t, notes, 12, "keep.md", "v1")

	// A 远程：owiki 自己的历史
	urlA, _ := seedFileRemote(t, "backup: sync from owiki", "keep.md", "old")
	cfg := &model.VaultGitBackup{VaultID: 12, Branch: "main", Enabled: true, RemoteURL: urlA}
	if _, err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatalf("first run on A: %v", err)
	}

	// B 远程：陌生历史（带一个手改文件 precious.md）
	urlB, _ := seedFileRemote(t, "foreign base", "precious.md", "hand edit")
	cfg.RemoteURL = urlB
	if _, err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatalf("self-heal run: %v", err)
	}

	backupRef := findDivergedRef(t, urlB)
	if backupRef == "" {
		t.Fatal("owiki/diverged-* backup branch should exist on remote B")
	}

	// 护底分支上 precious.md 可找回
	bareDir := strings.TrimPrefix(urlB, "file://")
	rr, _ := git.PlainOpen(bareDir)
	ref, err := rr.Reference(plumbing.ReferenceName("refs/heads/"+backupRef), true)
	if err != nil {
		t.Fatal(err)
	}
	c, err := rr.CommitObject(ref.Hash())
	if err != nil {
		t.Fatal(err)
	}
	tree, _ := c.Tree()
	if _, err := tree.File("precious.md"); err != nil {
		t.Fatal("precious.md should be recoverable from the diverged backup branch")
	}
}

// 差异识别：remote-only / differs / 相同不列 / .obsidian 忽略。
func TestRestoreDiffClassification(t *testing.T) {
	notes, _, runner, url := newRestoreDeps(t)
	upsertNote(t, notes, 21, "same.md", "identical")
	upsertNote(t, notes, 21, "changed.md", "db version")

	commitFileToRemote(t, url, "seed", map[string]string{
		"same.md":            "identical",  // 与 DB 相同：不应出现
		"changed.md":         "remote new", // differs
		"new.md":             "fresh",      // remote-only
		"folder/note.md":     "nested",     // remote-only
		".obsidian/app.json": "{}",         // 忽略
	}, nil)

	diff, err := runner.RestoreDiff(context.Background(), restoreCfg(21, url), "")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, it := range diff.Items {
		got[it.Path] = it.Type
	}
	if len(got) != 3 {
		t.Fatalf("want 3 items, got %d: %v", len(got), got)
	}
	if got["changed.md"] != "differs" || got["new.md"] != "remote-only" || got["folder/note.md"] != "remote-only" {
		t.Fatalf("classification wrong: %v", got)
	}
	if _, ok := got["same.md"]; ok {
		t.Fatal("identical file should not be listed")
	}
	if _, ok := got[".obsidian/app.json"]; ok {
		t.Fatal(".obsidian should be ignored")
	}
}

// 应用恢复：selected 模式只写选中文件；differs 覆盖 DB；remote-only 新建。
func TestRestoreApplySelected(t *testing.T) {
	notes, _, runner, url := newRestoreDeps(t)
	upsertNote(t, notes, 22, "changed.md", "db version")

	commitFileToRemote(t, url, "seed", map[string]string{
		"changed.md": "remote new",
		"new.md":     "fresh note",
	}, nil)

	res, err := runner.RestoreApply(context.Background(), restoreCfg(22, url), "", "selected", []string{"changed.md", "new.md"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied != 2 {
		t.Fatalf("applied=%d, skipped=%v", res.Applied, res.Skipped)
	}

	c, err := notes.GetByPath(context.Background(), 22, "changed.md")
	if err != nil || c.Content != "remote new" {
		t.Fatalf("changed.md should be restored: %v %q", err, c.Content)
	}
	n, err := notes.GetByPath(context.Background(), 22, "new.md")
	if err != nil || n.Content != "fresh note" {
		t.Fatalf("new.md should be created: %v %q", err, n.Content)
	}
}

// 护底分支作为恢复来源：被自愈冲掉的文件可从 owiki/diverged-* 找回。
func TestRestoreFromDivergedRef(t *testing.T) {
	notes, _, runner, url := newRestoreDeps(t)
	upsertNote(t, notes, 23, "keep.md", "v1")

	// 远程先有一版（含 precious.md，将随后被自愈冲掉）
	commitFileToRemote(t, url, "backup: sync from owiki", map[string]string{
		"keep.md":     "old",
		"precious.md": "hand edit",
	}, nil)
	if _, err := runner.Run(context.Background(), restoreCfg(23, url)); err != nil {
		t.Fatalf("first run: %v", err)
	}

	// 远程被外部改写 → 自愈（护底分支自动创建）。
	// 注意：precious.md 必须在改写 commit 里仍存在（外部改写者只加了文件、
	// 没删它），护底存的才是「改写后的远程 HEAD」。
	commitFileToRemote(t, url, "foreign rewrite", map[string]string{
		"unrelated.md": "x",
		"keep.md":      "old",
		"precious.md":  "hand edit",
	}, nil)
	upsertNote(t, notes, 23, "keep.md", "v2")
	if _, err := runner.Run(context.Background(), restoreCfg(23, url)); err != nil {
		t.Fatalf("self-heal run: %v", err)
	}

	backupRef := findDivergedRef(t, url)
	if backupRef == "" {
		t.Fatal("diverged backup ref should exist")
	}

	// 从护底分支 diff：precious.md 应为 remote-only
	diff, err := runner.RestoreDiff(context.Background(), restoreCfg(23, url), backupRef)
	if err != nil {
		t.Fatalf("diff from backup ref: %v", err)
	}
	found := false
	for _, it := range diff.Items {
		if it.Path == "precious.md" && it.Type == "remote-only" {
			found = true
		}
	}
	if !found {
		t.Fatalf("precious.md should be remote-only on %s, items=%v", backupRef, diff.Items)
	}

	// 恢复 precious.md
	res, err := runner.RestoreApply(context.Background(), restoreCfg(23, url), backupRef, "selected", []string{"precious.md"})
	if err != nil || res.Applied != 1 {
		t.Fatalf("restore: %v applied=%d", err, res.Applied)
	}
	p, err := notes.GetByPath(context.Background(), 23, "precious.md")
	if err != nil || p.Content != "hand edit" {
		t.Fatalf("precious.md restored content: %v %q", err, p.Content)
	}
}
