package webapi

import (
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// loginLimiter 登录接口的防暴力破解限速器（纯内存，重启清零）。
//
// 策略：按来源 IP 统计连续失败次数，指数退避锁定：
//
//	第 5 次失败起锁定，时长 = base << (fails-5)（1m, 2m, 4m ... 上限 1h）
//	登录成功即清零。全局（所有 IP 合计）也有一道更宽松的闸，
//	防止分布式慢速爆破。
type loginLimiter struct {
	mu       sync.Mutex
	ips      map[string]*ipFailState
	globalFails int
	globalLockUntil time.Time
}

type ipFailState struct {
	fails     int
	lockUntil time.Time
}

const (
	ipFailThreshold    = 5           // 连续失败几次后开始锁
	globalFailThreshold = 20          // 全局失败阈值（所有 IP 合计）
	baseLock           = time.Minute // 基础锁定时长，指数翻倍
	maxLock            = time.Hour
)

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{ips: make(map[string]*ipFailState)}
}

// clientIP 提取客户端 IP（优先 X-Forwarded-For / X-Real-IP，反代后正确归因）。
func clientIP(c *gin.Context) string {
	if v := c.GetHeader("X-Forwarded-For"); v != "" {
		// 取第一个（最初的客户端）
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	if v := c.GetHeader("X-Real-IP"); v != "" {
		return strings.TrimSpace(v)
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}

// blocked 该 IP 当前是否被锁；返回剩余时间。
func (l *loginLimiter) blocked(ip string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Before(l.globalLockUntil) {
		return true, l.globalLockUntil.Sub(now)
	}
	s := l.ips[ip]
	if s != nil && now.Before(s.lockUntil) {
		return true, s.lockUntil.Sub(now)
	}
	return false, 0
}

// recordFailure 登录失败：计数 + 可能触发指数退避锁定。
func (l *loginLimiter) recordFailure(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.globalFails++
	if l.globalFails >= globalFailThreshold {
		l.globalLockUntil = time.Now().Add(baseLock)
		l.globalFails = 0 // 重置计数，锁定到期后重新累计
		log.Printf("[auth] global login lockout triggered (threshold %d)", globalFailThreshold)
	}

	s := l.ips[ip]
	if s == nil {
		s = &ipFailState{}
		l.ips[ip] = s
	}
	s.fails++
	if s.fails >= ipFailThreshold {
		lock := baseLock << (s.fails - ipFailThreshold) // 1m,2m,4m...
		if lock > maxLock || lock <= 0 {
			lock = maxLock
		}
		s.lockUntil = time.Now().Add(lock)
		log.Printf("[auth] login lockout: ip=%s username=%q fails=%d lock=%s", ip, username, s.fails, lock)
	}
}

// recordSuccess 登录成功：清零该 IP 计数，全局计数减一（缓慢释放）。
func (l *loginLimiter) recordSuccess(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.ips, ip)
	if l.globalFails > 0 {
		l.globalFails--
	}
	// 顺手清理过期条目（失败总数少，map 很小）
	if len(l.ips) > 1000 {
		now := time.Now()
		for k, v := range l.ips {
			if now.After(v.lockUntil) && v.fails < ipFailThreshold {
				delete(l.ips, k)
			}
		}
	}
}

// wrapLogin 包裹登录 handler：前置锁检查 + 结果记录。
// 注意：login 是闭包传入的 handler，直接调用而非 c.Next()。
func (l *loginLimiter) wrapLogin(login gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := clientIP(c)
		if blocked, remain := l.blocked(ip); blocked {
			c.Header("Retry-After", strconv.Itoa(int(remain.Seconds())+1))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":      "尝试次数过多，请稍后再试",
				"retryAfter": int(remain.Seconds()) + 1,
			})
			c.Abort()
			return
		}
		// clientIP 通过 context 传给 login handler（成功/失败时上报）
		c.Set("clientIP", ip)
		login(c)
	}
}
