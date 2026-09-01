import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/lib/api.ts'
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
import { Badge } from '@/components/ui/badge.tsx'

type Step = 'idle' | 'scan' | 'enabled'

/**
 * 安全设置页：TOTP 二次认证的开启/关闭。
 * 开启流程：生成 secret → 扫二维码 → 输入一次验证码确认。
 * 关闭需要密码复核。
 */
export function SecurityPage() {
  const [step, setStep] = useState<Step>('idle')
  const [loading, setLoading] = useState(true)
  const [secret, setSecret] = useState('')
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshStatus = async () => {
    try {
      const s = await api.totpStatus()
      setStep(s.enabled ? 'enabled' : 'idle')
    } catch {
      setError('无法获取二次认证状态')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  // 生成二维码
  useEffect(() => {
    if (!otpauthUrl) return
    QRCode.toDataURL(otpauthUrl, { width: 192, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [otpauthUrl])

  const beginSetup = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api.totpSetup()
      setSecret(res.secret)
      setOtpauthUrl(res.otpauthUrl)
      setCode('')
      setStep('scan')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (code.length !== 6) return
    setBusy(true)
    setError('')
    try {
      await api.totpConfirm({ code })
      setStep('enabled')
      setNotice('二次认证已开启 ✅ 之后登录需要密码 + 动态验证码')
      setSecret('')
      setOtpauthUrl('')
    } catch (e) {
      setCode('')
      setError(e instanceof Error && e.message !== 'unauthorized' ? e.message : '验证码错误，请重试')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!password) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.totpDisable({ password })
      setStep('idle')
      setNotice('二次认证已关闭')
      setPassword('')
    } catch (e) {
      setPassword('')
      setError(e instanceof Error && e.message !== 'unauthorized' ? e.message : '密码错误')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">加载中…</div>

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">安全设置</h1>

      {notice && (
        <div className="rounded-md border border-primary/25 bg-primary/10 p-3 text-sm dark:bg-primary/15">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            二次认证（TOTP）
            {step === 'enabled' ? (
              <Badge className="bg-primary">已开启</Badge>
            ) : (
              <Badge variant="secondary">未开启</Badge>
            )}
          </CardTitle>
          <CardDescription>
            开启后登录需要「密码 + 动态验证码」两步，验证码由 Google Authenticator、
            1Password 等验证器 App 生成，每 30 秒更换。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'idle' && (
            <>
              <p className="text-muted-foreground text-sm">
                建议开启：即使密码泄露，攻击者没有你的手机也无法登录。
              </p>
              <Button onClick={() => void beginSetup()} disabled={busy}>
                {busy ? '生成中…' : '开启二次认证'}
              </Button>
            </>
          )}

          {step === 'scan' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="TOTP 二维码" className="rounded-md border" width={192} height={192} />
                ) : (
                  <div className="flex h-48 w-48 items-center justify-center rounded-md border text-xs text-muted-foreground">
                    二维码生成中…
                  </div>
                )}
                <p className="text-muted-foreground text-center text-xs">
                  用验证器 App 扫码添加。无法扫码时手动输入密钥：
                  <code className="mt-1 block max-w-full break-all rounded bg-muted px-2 py-1 font-mono">
                    {secret}
                  </code>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-code">输入 App 上的 6 位验证码确认</Label>
                <Input
                  id="confirm-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6 位数字"
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  onKeyDown={(e) => e.key === 'Enter' && void confirm()}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void confirm()} disabled={busy || code.length !== 6}>
                  {busy ? '确认中…' : '确认开启'}
                </Button>
                <Button variant="outline" onClick={() => void refreshStatus()} disabled={busy}>
                  取消
                </Button>
              </div>
            </div>
          )}

          {step === 'enabled' && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                关闭后登录只需密码。此操作敏感，需输入登录密码确认。
              </p>
              <div className="space-y-2">
                <Label htmlFor="disable-password">登录密码</Label>
                <Input
                  id="disable-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void disable()}
                />
              </div>
              <Button variant="destructive" onClick={() => void disable()} disabled={busy || !password}>
                {busy ? '关闭中…' : '关闭二次认证'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
