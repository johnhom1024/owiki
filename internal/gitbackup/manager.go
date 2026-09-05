package gitbackup

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"owiki/internal/events"
	"owiki/internal/feature"
	"owiki/internal/repository"
)

// FeatureID L2 feature 注册 id（与 feature_register.go 保持一致）。
const FeatureID = "gitbackup"

// Manager 管「哪些 vault 开了 git 备份」：订阅 events.Hub 的写入事件做防抖触发，
// 每 vault 一个串行 worker（同一 vault 绝不并发跑 git 操作）。
// feature 总开关关闭时全部 worker 暂停（保留配置与工作树）。
type Manager struct {
	repo   *repository.GitBackupRepo
	runner *Runner
	events *events.Hub
	syncLog *repository.SyncLogRepo

	mu      sync.Mutex
	workers map[int64]*worker
	// 全局开关缓存（feature registry 是权威，这里避免热路径每次查锁）
	enabled bool
}

func NewManager(repo *repository.GitBackupRepo, runner *Runner, eventHub *events.Hub, syncLog *repository.SyncLogRepo) *Manager {
	m := &Manager{
		repo:    repo,
		runner:  runner,
		events:  eventHub,
		syncLog: syncLog,
		workers: make(map[int64]*worker),
	}
	feature.RegisterStateListener(m.onFeatureChanged)
	return m
}

// onFeatureChanged feature 总开关变化回调（开→起 worker / 关→暂停）。
func (m *Manager) onFeatureChanged(id string, enabled bool) {
	if id != FeatureID {
		return
	}
	m.mu.Lock()
	m.enabled = enabled
	m.mu.Unlock()
	if enabled {
		m.Start(context.Background())
	} else {
		m.StopAll()
	}
}

// Start 扫表：为全部 enabled 配置起 worker（幂等：已在跑的跳过）。
// main 启动时调用一次；feature 重新开启时再调。
func (m *Manager) Start(ctx context.Context) {
	if !feature.Use().Enabled(FeatureID) {
		return
	}
	m.mu.Lock()
	m.enabled = true
	m.mu.Unlock()

	cfgs, err := m.repo.ListEnabled(ctx)
	if err != nil {
		log.Printf("[gitbackup] list enabled: %v", err)
		return
	}
	for _, cfg := range cfgs {
		m.EnsureWorker(cfg.VaultID)
	}
	log.Printf("[gitbackup] manager started, %d enabled vault(s)", len(cfgs))
}

// EnsureWorker 幂等起 worker（配置开启时由 API 调用）。
func (m *Manager) EnsureWorker(vaultID int64) *worker {
	m.mu.Lock()
	defer m.mu.Unlock()
	if w, ok := m.workers[vaultID]; ok {
		return w
	}
	w := newWorker(m, vaultID)
	m.workers[vaultID] = w
	go w.loop()
	return w
}

// RemoveWorker vault 删除/配置关闭时停 worker + 清工作树。
func (m *Manager) RemoveWorker(vaultID int64) {
	m.mu.Lock()
	w, ok := m.workers[vaultID]
	if ok {
		delete(m.workers, vaultID)
	}
	m.mu.Unlock()
	if ok {
		w.stop()
	}
}

// StopAll feature 关闭时全部暂停（不删工作树；重新开启可继续）。
func (m *Manager) StopAll() {
	m.mu.Lock()
	ws := make([]*worker, 0, len(m.workers))
	for _, w := range m.workers {
		ws = append(ws, w)
	}
	m.workers = make(map[int64]*worker)
	m.mu.Unlock()
	for _, w := range ws {
		w.stop()
	}
	log.Printf("[gitbackup] manager stopped (feature disabled)")
}

// OnVaultDeleted vault 删除的清理入口（webapi DELETE /vaults/:vid 调用）。
func (m *Manager) OnVaultDeleted(vaultID int64) {
	m.RemoveWorker(vaultID)
	_ = m.repo.DeleteByVault(context.Background(), vaultID)
	_ = m.runner.RemoveWorktree(vaultID)
}

// RunNow 立即触发一轮（跳过防抖）：PUT 配置后 / 手动「立即备份」按钮。
// worker 未起（配置未 enabled）时现场起一个跑完这轮就走正常循环。
func (m *Manager) RunNow(vaultID int64) {
	if !m.Enabled() {
		return
	}
	w := m.EnsureWorker(vaultID)
	w.trigger()
}

// Notify 写入事件入口：任何 vault.log / vault.sync_done / note.synced 事件都来这。
// worker 不存在（未开备份的 vault）时静默忽略。
func (m *Manager) Notify(vaultID int64) {
	if !m.Enabled() {
		return
	}
	m.mu.Lock()
	w, ok := m.workers[vaultID]
	m.mu.Unlock()
	if ok {
		w.notify()
	}
}

// Enabled 总开关是否开着（feature registry 权威）。
func (m *Manager) Enabled() bool {
	return feature.Use().Enabled(FeatureID)
}

// ---------- 事件订阅 ----------

// StartEventLoop 订阅 events.Hub，把写入事件转成对应 vault 的防抖触发。
// main 里 goroutine 起一次。
func (m *Manager) StartEventLoop(ctx context.Context) {
	sub := m.events.Subscribe()
	go func() {
		defer m.events.Unsubscribe(sub)
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-sub:
				if !ok {
					return
				}
				switch ev.Type {
				case "vault.log", "vault.sync_done", "note.synced":
					m.Notify(ev.VaultID)
				}
			}
		}
	}()
}

// ---------- worker ----------

// worker 单 vault 的备份循环：notify 计数 → 防抖到点 → 串行跑一轮。
type worker struct {
	m        *Manager
	vaultID  int64
	notifyCh chan struct{} // 带缓冲：事件触发去重（走防抖）
	runNowCh chan struct{} // 带缓冲：立即备份（跳过防抖）
	stopCh   chan struct{}
	once     sync.Once
}

func newWorker(m *Manager, vaultID int64) *worker {
	return &worker{
		m:        m,
		vaultID:  vaultID,
		notifyCh: make(chan struct{}, 1),
		runNowCh: make(chan struct{}, 1),
		stopCh:   make(chan struct{}),
	}
}

func (w *worker) notify() {
	select {
	case w.notifyCh <- struct{}{}:
	default: // 已有待处理的触发，合并
	}
}

func (w *worker) trigger() {
	select {
	case w.runNowCh <- struct{}{}:
	default:
	}
}

func (w *worker) stop() {
	w.once.Do(func() { close(w.stopCh) })
}

func (w *worker) loop() {
	for {
		select {
		case <-w.stopCh:
			return
		case <-w.runNowCh:
			w.runOnce()
		case <-w.notifyCh:
			cfg, err := w.m.repo.GetByVault(context.Background(), w.vaultID)
			if err != nil || !cfg.Enabled {
				continue
			}
			debounce := time.Duration(cfg.DebounceSec) * time.Second
			if debounce <= 0 {
				debounce = 15 * time.Second
			}
			timer := time.NewTimer(debounce)
		wait:
			for {
				select {
				case <-w.stopCh:
					timer.Stop()
					return
				case <-w.runNowCh:
					// 「立即备份」打断防抖，马上跑
					timer.Stop()
					break wait
				case <-w.notifyCh:
					if !timer.Stop() {
						select {
						case <-timer.C:
						default:
						}
					}
					timer.Reset(debounce)
				case <-timer.C:
					break wait
				}
			}
			w.runOnce()
		}
	}
}

// runOnce 单轮执行：状态回写 + Runner.Run + sync_log 留痕。
func (w *worker) runOnce() {
	if !w.m.Enabled() {
		return
	}
	ctx := context.Background()
	cfg, err := w.m.repo.GetByVault(ctx, w.vaultID)
	if err != nil || !cfg.Enabled {
		return
	}
	_ = w.m.repo.UpdateStatus(ctx, w.vaultID, "running", "", time.Now())

	res, err := w.m.runner.Run(ctx, cfg)
	if err != nil {
		// 脱敏兜底：错误信息里不应有 token（凭据只进传输层，但保险起见再洗一次）
		msg := sanitizeErr(err)
		_ = w.m.repo.UpdateStatus(ctx, w.vaultID, "error", msg, time.Now())
		if w.m.syncLog != nil {
			w.m.syncLog.Record(ctx, w.vaultID, "gitbackup.error", "", msg, "gitbackup", "", "Git 备份", 0)
		}
		log.Printf("[gitbackup] vault=%d run error: %v", w.vaultID, msg)
		return
	}
	_ = w.m.repo.UpdateSuccess(ctx, w.vaultID, res.CommitSHA, res.Pushed, time.Now())
	if res.Committed {
		if w.m.syncLog != nil {
			w.m.syncLog.Record(ctx, w.vaultID, "gitbackup.commit", "", res.CommitSHA, "gitbackup", "", "Git 备份", int64(res.Files))
		}
		log.Printf("[gitbackup] vault=%d commit=%s files=%d pushed=%v", w.vaultID, res.CommitSHA, res.Files, res.Pushed)
	}
}

// sanitizeErr 错误信息去 token：go-git 的传输错误偶尔会把 URL（含 userinfo）带出来。
func sanitizeErr(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	// BasicAuth 不会明文回显，但 URL userinfo 会——把 ://user:pass@ 形态洗掉
	if i := strings.Index(msg, "://"); i >= 0 {
		if j := strings.Index(msg[i+3:], "@"); j >= 0 {
			msg = msg[:i+3] + msg[i+3+j+1:]
		}
	}
	if len(msg) > 500 {
		msg = msg[:500]
	}
	return msg
}
