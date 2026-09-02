import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/lib/api.ts'
import { useLang } from '@/i18n/LangProvider.tsx'
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
  const { t } = useLang()
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
      setError(t.security.statusFailed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(e instanceof Error ? e.message : t.security.generateFailed)
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
      setNotice(t.security.enabledNotice)
      setSecret('')
      setOtpauthUrl('')
    } catch (e) {
      setCode('')
      setError(
        e instanceof Error && e.message !== 'unauthorized' ? e.message : t.security.wrongCode,
      )
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
      setNotice(t.security.disabledNotice)
      setPassword('')
    } catch (e) {
      setPassword('')
      setError(
        e instanceof Error && e.message !== 'unauthorized' ? e.message : t.security.wrongPassword,
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t.security.title}</h1>

      {notice && (
        <div className="rounded-md border border-primary/25 bg-primary/10 p-3 text-sm dark:bg-primary/15">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {t.security.totp}
            {step === 'enabled' ? (
              <Badge className="bg-primary">{t.security.enabled}</Badge>
            ) : (
              <Badge variant="secondary">{t.security.disabled}</Badge>
            )}
          </CardTitle>
          <CardDescription>{t.security.desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'idle' && (
            <>
              <p className="text-muted-foreground text-sm">{t.security.suggest}</p>
              <Button onClick={() => void beginSetup()} disabled={busy}>
                {busy ? t.security.generating : t.security.enable}
              </Button>
            </>
          )}

          {step === 'scan' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt={t.security.qrAlt} className="rounded-md border" width={192} height={192} />
                ) : (
                  <div className="text-muted-foreground flex h-48 w-48 items-center justify-center rounded-md border text-xs">
                    {t.security.qrLoading}
                  </div>
                )}
                <p className="text-muted-foreground text-center text-xs">
                  {t.security.scanHint}
                  <code className="mt-1 block max-w-full break-all rounded bg-muted px-2 py-1 font-mono">
                    {secret}
                  </code>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-code">{t.security.codeLabel}</Label>
                <Input
                  id="confirm-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t.security.codePlaceholder}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  onKeyDown={(e) => e.key === 'Enter' && void confirm()}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void confirm()} disabled={busy || code.length !== 6}>
                  {busy ? t.security.confirming : t.security.confirmEnable}
                </Button>
                <Button variant="outline" onClick={() => void refreshStatus()} disabled={busy}>
                  {t.common.cancel}
                </Button>
              </div>
            </div>
          )}

          {step === 'enabled' && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">{t.security.disableHint}</p>
              <div className="space-y-2">
                <Label htmlFor="disable-password">{t.security.passwordLabel}</Label>
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
                {busy ? t.security.disabling : t.security.disable}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
