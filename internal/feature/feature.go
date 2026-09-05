// Package feature 实现「L2 内置插件」的注册中心：
//
//   - 每个功能编译期注册一条 Desc（ID/名称/默认开关/是否可关），
//     路由仍静态挂载，但运行时由 Require 中间件按请求门禁；
//   - 开关状态优先级：DB settings 值（用户 UI 动过）> env 覆盖
//     （首次启动默认）> 代码 Default；
//   - 用户一旦在 UI 改过（DB 有记录），env 不再有决定权，避免重启跳回。
//
// 设计笔记：Obsidian「万物即插件：L2 内置插件架构方案」。
package feature

import (
	"net/http"
	"sort"
	"sync"

	"github.com/gin-gonic/gin"
)

// Desc 一个内置插件（功能模块）的静态描述。
type Desc struct {
	// ID 唯一标识（如 "share"）。settings 键为 feature.<id>.enabled。
	ID string
	// Name 展示名（Web 设置页）。
	Name string
	// Desc 功能说明（Web 设置页）。
	Desc string
	// Default 无任何覆盖时的默认开关。
	Default bool
	// CanToggle false 表示核心功能（vault/认证/同步本体），不提供开关。
	CanToggle bool
	// EnvKey 可选：首次启动默认值的环境变量（如 OWIKI_SHARE）。仅 DB 无记录时生效。
	EnvKey string
}

// StateDesc Desc + 运行时开关状态，/api/features 响应用。
type StateDesc struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	Enabled   bool   `json:"enabled"`
	CanToggle bool   `json:"canToggle"`
}

// Registry 运行时开关状态。热路径 Enabled() 只读锁。
type Registry struct {
	mu       sync.RWMutex
	features map[string]Desc
	enabled  map[string]bool
}

// NewRegistry 建独立注册中心（测试用）；业务代码用全局 Use()。
func NewRegistry() *Registry {
	return &Registry{
		features: make(map[string]Desc),
		enabled:  make(map[string]bool),
	}
}

var (
	globalMu  sync.RWMutex
	globalReg = NewRegistry()
)

// Register 全局注册一个功能模块（编译期调用）。重复 ID panic（编码错误）。
func Register(d Desc) {
	globalMu.Lock()
	defer globalMu.Unlock()
	if _, dup := globalReg.features[d.ID]; dup {
		panic("feature: duplicate id " + d.ID)
	}
	globalReg.features[d.ID] = d
	globalReg.enabled[d.ID] = d.Default
}

// Use 返回全局注册中心。
func Use() *Registry { return globalReg }

// Enabled 查询运行时开关（热路径，读锁）。未注册的 id 恒 false。
func (r *Registry) Enabled(id string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.enabled[id]
}

// List 全部功能及状态（按 ID 排序，前端设置页展示）。
func (r *Registry) List() []StateDesc {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]StateDesc, 0, len(r.features))
	for id, d := range r.features {
		out = append(out, StateDesc{
			ID: id, Name: d.Name, Desc: d.Desc,
			Enabled: r.enabled[id], CanToggle: d.CanToggle,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// LoadSettings 启动时从 DB settings 批量加载用户值。
// 优先级：DB 值 > env（首次启动默认） > 代码 Default。
// 返回实际生效状态，供启动日志输出。
func (r *Registry) LoadSettings(dbValues map[string]string, env func(string) string) map[string]bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]bool, len(r.features))
	for id, d := range r.features {
		if v, ok := dbValues[SettingKey(id)]; ok {
			// DB 有用户值：权威，env 不再有决定权
			r.enabled[id] = v == "true"
		} else if d.EnvKey != "" && env != nil {
			if ev := env(d.EnvKey); ev != "" {
				r.enabled[id] = !(ev == "off" || ev == "false" || ev == "0")
			} else {
				r.enabled[id] = d.Default
			}
		} else {
			r.enabled[id] = d.Default
		}
		out[id] = r.enabled[id]
	}
	return out
}

// SetEnabled 运行时改开关。CanToggle=false 的功能拒绝（返回 false）。
// 持久化到 settings 表由调用方完成（repo 与 feature 包解耦）。
// 成功后通知 StateListener（如 gitbackup Manager 起停 worker）。
func (r *Registry) SetEnabled(id string, on bool) bool {
	r.mu.Lock()
	d, ok := r.features[id]
	if !ok || !d.CanToggle {
		r.mu.Unlock()
		return false
	}
	r.enabled[id] = on
	r.mu.Unlock()
	notifyListeners(id, on)
	return true
}

// SettingKey feature id → settings 表键。
func SettingKey(id string) string { return "feature." + id + ".enabled" }

// StateListener feature 开关变化回调（Manager 订阅 gitbackup 总开关用）。
type StateListener func(id string, enabled bool)

// listeners 开关变化监听者。SetEnabled 成功后逐个回调（同步调用，回调内不要再锁 Registry）。
var listeners []StateListener

// RegisterStateListener 注册开关变化监听者（进程生命周期内有效）。
func RegisterStateListener(l StateListener) {
	globalMu.Lock()
	listeners = append(listeners, l)
	globalMu.Unlock()
}

func notifyListeners(id string, enabled bool) {
	globalMu.RLock()
	ls := make([]StateListener, len(listeners))
	copy(ls, listeners)
	globalMu.RUnlock()
	for _, l := range ls {
		l(id, enabled)
	}
}

// Require gin 中间件：feature 关闭时直接 404。挂在功能路由组上。
//
//	share := r.Group("/api", feature.Require("share"))
func Require(id string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !Use().Enabled(id) {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{
				"error": "feature disabled: " + id,
			})
			return
		}
		c.Next()
	}
}
