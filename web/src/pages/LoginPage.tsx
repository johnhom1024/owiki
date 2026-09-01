import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, RateLimitError } from '@/lib/api.ts'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx'

/**
 * 登录页：单管理员（服务端由 OWIKI_ADMIN_USER/OWIKI_ADMIN_PASSWORD 初始化）。
 * 支持两步登录：密码 → （若启用 TOTP）6 位动态验证码。
 * 未初始化时展示引导提示。
 */
export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // TOTP 第二步状态：票据 + 6 位码
  const [totpTicket, setTotpTicket] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const totpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setInitialized(s.initialized))
      .catch(() => setInitialized(null))
  }, [])

  // 进入第二步时聚焦验证码输入框
  useEffect(() => {
    if (totpTicket) requestAnimationFrame(() => totpInputRef.current?.focus())
  }, [totpTicket])

  /** 错误信息统一处理（含限速提示） */
  const errText = (err: unknown, fallback: string) => {
    if (err instanceof RateLimitError) {
      const mins = Math.ceil(err.retryAfter / 60)
      return `尝试次数过多，已临时锁定，请约 ${mins >= 1 ? `${mins} 分钟` : `${err.retryAfter} 秒`}后再试`
    }
    if (err instanceof Error && err.message !== 'unauthorized' && err.message !== 'rate limited') {
      return err.message
    }
    return fallback
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setSubmitting(true)
    setError('')
    try {
      const res = await api.login({ username, password })
      if (res.needTotp && res.totpTicket) {
        // 密码正确，但启用了二次认证 → 切换到第二步
        setTotpTicket(res.totpTicket)
        setPassword('')
        return
      }
      onLoggedIn()
      navigate('/', { replace: true })
    } catch (err) {
      // 失败清空密码框：避免反复试错时残留旧密码造成误提交
      setPassword('')
      setError(errText(err, '登录失败，请检查用户名和密码'))
      // 焦点回到密码框，方便直接重输
      requestAnimationFrame(() => document.getElementById('password')?.focus())
    } finally {
      setSubmitting(false)
    }
  }

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!totpTicket || totpCode.length !== 6) return
    setSubmitting(true)
    setError('')
    try {
      await api.loginTotp({ totpTicket, code: totpCode })
      onLoggedIn()
      navigate('/', { replace: true })
    } catch (err) {
      setTotpCode('')
      setError(errText(err, '验证码错误或已过期'))
      requestAnimationFrame(() => totpInputRef.current?.focus())
    } finally {
      setSubmitting(false)
    }
  }

  /** 第二步返回第一步（重新输密码） */
  const backToPassword = () => {
    setTotpTicket(null)
    setTotpCode('')
    setError('')
    requestAnimationFrame(() => document.getElementById('password')?.focus())
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Logo className="size-9" />
            <CardTitle className="text-xl">OWiki 登录</CardTitle>
          </div>
          <CardDescription>
            {totpTicket ? '已启用二次认证，请输入动态验证码' : 'OWiki · 自部署笔记同步服务，请登录后继续'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialized === false && !totpTicket && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              管理员尚未初始化。请在服务端设置环境变量{' '}
              <code className="font-mono">OWIKI_ADMIN_USER</code> /{' '}
              <code className="font-mono">OWIKI_ADMIN_PASSWORD</code>{' '}
              后重启服务，再回来登录。
            </div>
          )}

          {totpTicket ? (
            /* ---------- 第二步：TOTP 验证码 ---------- */
            <form onSubmit={submitTotp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="totp-code">动态验证码</Label>
                <Input
                  id="totp-code"
                  ref={totpInputRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6 位数字"
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  required
                />
                <p className="text-muted-foreground text-xs">
                  打开你的验证器 App（Google Authenticator / 1Password 等），输入当前显示的 6 位码
                </p>
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || totpCode.length !== 6}>
                {submitting ? '验证中…' : '验证并登录'}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={backToPassword}>
                返回重新输入密码
              </Button>
            </form>
          ) : (
            /* ---------- 第一步：用户名 + 密码 ---------- */
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? '登录中…' : '登录'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
