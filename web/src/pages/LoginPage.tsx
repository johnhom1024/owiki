import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, RateLimitError } from '@/lib/api.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
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
  const { t, toggle } = useLang()
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
      return mins >= 1
        ? fill(t.login.rateLimitedMin, { n: mins })
        : fill(t.login.rateLimitedSec, { n: err.retryAfter })
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
        setTotpTicket(res.totpTicket)
        setPassword('')
        return
      }
      onLoggedIn()
      navigate('/', { replace: true })
    } catch (err) {
      setPassword('')
      setError(errText(err, t.login.failed))
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
      setError(errText(err, t.login.totpFailed))
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
      {/* 语言切换：登录页也可用 */}
      <button
        onClick={toggle}
        className="text-muted-foreground hover:text-foreground fixed top-4 right-4 rounded-md border px-2.5 py-1 text-xs font-semibold"
      >
        {t.nav.langToggle}
      </button>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Logo className="size-9" />
            <CardTitle className="text-xl">{t.login.title}</CardTitle>
          </div>
          <CardDescription>
            {totpTicket ? t.login.totpDesc : t.login.desc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialized === false && !totpTicket && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {t.login.notInitialized}
            </div>
          )}

          {totpTicket ? (
            /* ---------- 第二步：TOTP 验证码 ---------- */
            <form onSubmit={submitTotp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="totp-code">{t.login.totpLabel}</Label>
                <Input
                  id="totp-code"
                  ref={totpInputRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t.login.totpPlaceholder}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  required
                />
                <p className="text-muted-foreground text-xs">{t.login.totpHint}</p>
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || totpCode.length !== 6}>
                {submitting ? t.login.totpSubmitting : t.login.totpSubmit}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={backToPassword}>
                {t.login.backToPassword}
              </Button>
            </form>
          ) : (
            /* ---------- 第一步：用户名 + 密码 ---------- */
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t.login.username}</Label>
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
                <Label htmlFor="password">{t.login.password}</Label>
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
                {submitting ? t.login.submitting : t.login.submit}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
