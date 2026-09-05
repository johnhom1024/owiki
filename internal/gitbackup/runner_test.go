package gitbackup

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"owiki/internal/model"
	"owiki/internal/repository"

	"github.com/go-git/go-billy/v5/osfs"
	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/cache"
	"github.com/go-git/go-git/v5/plumbing/storer"
	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/client"
	"github.com/go-git/go-git/v5/plumbing/transport/server"
	"github.com/go-git/go-git/v5/storage/filesystem"
)

// newTestDeps 建一套最小依赖：NoteRepo + AttachStore + Runner（临时目录）。
func newTestDeps(t *testing.T) (*repository.NoteRepo, *repository.AttachStore, *Runner) {
	t.Helper()
	dir := t.TempDir()
	notes, err := repository.NewNoteRepo(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	attach, err := repository.NewAttachStore(filepath.Join(dir, "attachments"))
	if err != nil {
		t.Fatal(err)
	}
	runner, err := NewRunner(notes, attach, filepath.Join(dir, "gitbackup"))
	if err != nil {
		t.Fatal(err)
	}
	return notes, attach, runner
}

func upsertNote(t *testing.T, notes *repository.NoteRepo, vaultID int64, p, content string) {
	t.Helper()
	err := notes.Upsert(context.Background(), &model.Note{
		VaultID: vaultID, Path: p, Content: content, ContentHash: hashOf(content), Mtime: 1, Size: int64(len(content)),
	})
	if err != nil {
		t.Fatal(err)
	}
}

func hashOf(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// 物化 → commit：首轮回全量，无变更时二轮 IsClean 跳过。
func TestRunnerCommitAndIdempotent(t *testing.T) {
	notes, _, runner := newTestDeps(t)
	upsertNote(t, notes, 1, "a.md", "hello")
	upsertNote(t, notes, 1, "dir/b.md", "world")

	cfg := &model.VaultGitBackup{VaultID: 1, Branch: "main", Enabled: true}

	// 首轮：2 文件全量物化 + commit
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Committed || res.Files != 2 {
		t.Fatalf("first run: committed=%v files=%d", res.Committed, res.Files)
	}

	// 二轮（无变更）：clean，不 commit
	res2, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if res2.Committed || res2.Files != 0 {
		t.Fatalf("second run should be clean: committed=%v files=%d", res2.Committed, res2.Files)
	}
	if res2.CommitSHA != res.CommitSHA {
		t.Fatalf("sha drifted: %s vs %s", res2.CommitSHA, res.CommitSHA)
	}
}

// 内容变更与删除都被物化对账捕获。
func TestRunnerUpdateAndDelete(t *testing.T) {
	notes, _, runner := newTestDeps(t)
	upsertNote(t, notes, 2, "x.md", "v1")
	upsertNote(t, notes, 2, "y.md", "keep")

	cfg := &model.VaultGitBackup{VaultID: 2, Branch: "main", Enabled: true}
	if _, err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	// 更新 x.md、删 y.md
	upsertNote(t, notes, 2, "x.md", "v2")
	if err := notes.DeleteByPath(context.Background(), 2, "y.md"); err != nil {
		t.Fatal(err)
	}
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Committed || res.Files != 2 {
		t.Fatalf("update+delete run: committed=%v files=%d", res.Committed, res.Files)
	}

	// 工作树里 y.md 应已删除
	if _, err := os.Stat(filepath.Join(runner.worktreePath(2), "y.md")); !os.IsNotExist(err) {
		t.Fatal("y.md should be removed from worktree")
	}
	// x.md 内容是新值
	b, _ := os.ReadFile(filepath.Join(runner.worktreePath(2), "x.md"))
	if string(b) != "v2" {
		t.Fatalf("x.md content = %q", string(b))
	}
}

// 附件物化：从 AttachStore 拷贝字节到工作树。
func TestRunnerAttachment(t *testing.T) {
	notes, attach, runner := newTestDeps(t)
	// 附件元数据行 + 磁盘文件
	png := string([]byte{0x89, 0x50, 0x4E, 0x47, 1, 2, 3})
	if _, err := attach.Save(3, "img/pic.png", base64.StdEncoding.EncodeToString([]byte(png))); err != nil {
		t.Fatal(err)
	}
	// 附件行的 ContentHash 用磁盘文件 hash（与真实链路一致）
	h, err := attach.Hash(3, "img/pic.png")
	if err != nil {
		t.Fatal(err)
	}
	err = notes.Upsert(context.Background(), &model.Note{
		VaultID: 3, Path: "img/pic.png", Content: "", ContentHash: h, Mtime: 1, Size: int64(len(png)),
	})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &model.VaultGitBackup{VaultID: 3, Branch: "main", Enabled: true}
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Committed || res.Files != 1 {
		t.Fatalf("attach run: committed=%v files=%d", res.Committed, res.Files)
	}
	b, err := os.ReadFile(filepath.Join(runner.worktreePath(3), "img", "pic.png"))
	if err != nil || string(b) != png {
		t.Fatalf("attachment bytes mismatch: err=%v len=%d", err, len(b))
	}
}

// 无 remote 时 commit 成功、push 跳过（本地攒着）。
func TestRunnerNoRemote(t *testing.T) {
	notes, _, runner := newTestDeps(t)
	upsertNote(t, notes, 4, "n.md", "local only")

	cfg := &model.VaultGitBackup{VaultID: 4, Branch: "main", Enabled: true, RemoteURL: ""}
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Committed || res.Pushed {
		t.Fatalf("no-remote: committed=%v pushed=%v", res.Committed, res.Pushed)
	}
}

// 进程内 git server 当 remote：避开系统 git-receive-pack 的 advertisement 与
// go-git 解析不兼容（git 2.44 object-format 能力会让 file:// 协议解码失败）。
// 自定义 Loader 忽略 endpoint 路径，直接映射到测试目录里的 bare 仓库。
type fixedLoader struct{ dir string }

func (l *fixedLoader) Load(ep *transport.Endpoint) (storer.Storer, error) {
	fs := osfs.New(l.dir)
	if _, err := fs.Stat("config"); err != nil {
		return nil, transport.ErrRepositoryNotFound
	}
	return filesystem.NewStorage(fs, cache.NewObjectLRUDefault()), nil
}

func installTestRemote(t *testing.T, remoteDir string) {
	t.Helper()
	if err := os.MkdirAll(remoteDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := git.PlainInitWithOptions(remoteDir, &git.PlainInitOptions{
		Bare:        true,
		InitOptions: git.InitOptions{DefaultBranch: plumbing.NewBranchReferenceName("main")},
	}); err != nil {
		t.Fatal(err)
	}
	client.InstallProtocol("test", server.NewClient(&fixedLoader{dir: remoteDir}))
	t.Cleanup(func() { client.InstallProtocol("test", nil) })
}

func testRemoteURL() string { return "test://dummy" }

// push 到进程内 remote：全链路 commit→push 验证。
func TestRunnerPushToInProcessRemote(t *testing.T) {
	notes, _, runner := newTestDeps(t)
	upsertNote(t, notes, 5, "p.md", "push me")

	remoteDir := filepath.Join(t.TempDir(), "remote.git")
	installTestRemote(t, remoteDir)

	cfg := &model.VaultGitBackup{VaultID: 5, Branch: "main", Enabled: true, RemoteURL: testRemoteURL()}
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatalf("push run: %v", err)
	}
	if !res.Committed || !res.Pushed {
		t.Fatalf("push: committed=%v pushed=%v", res.Committed, res.Pushed)
	}

	// remote 侧验证：打开 bare 仓库读 main 分支上的 p.md
	rr, err := git.PlainOpen(remoteDir)
	if err != nil {
		t.Fatal(err)
	}
	head, err := rr.Head()
	if err != nil {
		t.Fatal(err)
	}
	if head.Name().Short() != "main" {
		t.Fatalf("remote branch = %s", head.Name().Short())
	}
	commit, err := rr.CommitObject(head.Hash())
	if err != nil {
		t.Fatal(err)
	}
	tree, err := commit.Tree()
	if err != nil {
		t.Fatal(err)
	}
	f, err := tree.File("p.md")
	if err != nil {
		t.Fatal(err)
	}
	body, err := f.Contents()
	if err != nil || body != "push me" {
		t.Fatalf("remote content mismatch: err=%v content=%q", err, body)
	}
}

// 二次 push（无新 commit）：already up-to-date 视为成功。
func TestRunnerPushIdempotent(t *testing.T) {
	notes, _, runner := newTestDeps(t)
	upsertNote(t, notes, 6, "q.md", "once")

	remoteDir := filepath.Join(t.TempDir(), "remote.git")
	installTestRemote(t, remoteDir)

	cfg := &model.VaultGitBackup{VaultID: 6, Branch: "main", Enabled: true, RemoteURL: testRemoteURL()}
	if _, err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	// 无变更再跑一轮：clean → 不 commit → 不 push，无错误
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if res.Committed {
		t.Fatal("should not commit twice for no changes")
	}
}

// 工作树损坏（直接删掉 .git）：Run 自动重建并保持内容正确。
func TestRunnerWorktreeRecovery(t *testing.T) {
	notes, _, runner := newTestDeps(t)
	upsertNote(t, notes, 7, "r.md", "recover")

	cfg := &model.VaultGitBackup{VaultID: 7, Branch: "main", Enabled: true}
	if _, err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	// 模拟损坏：删掉整个工作树
	if err := os.RemoveAll(runner.worktreePath(7)); err != nil {
		t.Fatal(err)
	}
	res, err := runner.Run(context.Background(), cfg)
	if err != nil {
		t.Fatalf("recovery run: %v", err)
	}
	if !res.Committed {
		t.Fatal("recovery should re-commit everything")
	}
	b, _ := os.ReadFile(filepath.Join(runner.worktreePath(7), "r.md"))
	if string(b) != "recover" {
		t.Fatalf("content after recovery = %q", string(b))
	}
}

// sanitizeErr：URL userinfo 脱敏。
func TestSanitizeErr(t *testing.T) {
	in := "Get \"https://user:secret@github.com/x/y.git/info/refs?service=git-upload-pack\": dial tcp: timeout"
	out := sanitizeErr(&fakeErr{in})
	if strings.Contains(out, "secret") {
		t.Fatalf("token leaked: %s", out)
	}
	if !strings.Contains(out, "github.com") {
		t.Fatalf("host should survive: %s", out)
	}
}

type fakeErr struct{ msg string }

func (e *fakeErr) Error() string { return e.msg }
