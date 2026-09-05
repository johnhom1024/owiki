import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Check, Copy, Link2, QrCode, Share2 } from 'lucide-react'
import { api } from '@/lib/api.ts'
import { useLang } from '@/i18n/LangProvider.tsx'
import { cn, copyText } from '@/lib/utils.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'

/** 移动端断点（与 Tailwind md: 一致） */
const MOBILE_QUERY = '(max-width: 767px)'

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/**
 * 文章详情工具栏的「分享」按钮 + 浮窗：
 * 开启对外分享后展示外链（/share/<token>），可复制、可扫二维码。
 * token 首次开启时由服务端生成，之后开开关关 URL 不变。
 *
 * 弹窗定位：桌面端锚定按钮下方（absolute right-0）；
 * 移动端为底部浮层（fixed + portal 到 body）——必须走 portal，
 * 因为详情页 header 带 backdrop-blur（filter 创建 containing block），
 * fixed 子元素会被困在 header 内无法相对视口定位。
 */
export function ShareButton({ fileId }: { fileId: number }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

  // 打开浮窗时拉取当前分享状态（只拉一次，之后本地维护）
  useEffect(() => {
    if (!open || loaded) return
    api
      .getShare(fileId)
      .then((s) => {
        setEnabled(s.enabled)
        setToken(s.token)
        setLoaded(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t.share.loadFailed))
  }, [open, loaded, fileId])

  // fileId 变化（路由切换文章，组件被复用不重建）：重置全部状态，
  // 否则浮窗里显示的还是上一篇的分享链接（loaded=true 导致不重新拉取）
  useEffect(() => {
    setEnabled(false)
    setToken('')
    setLoaded(false)
    setShowQr(false)
    setQrDataUrl('')
    setError(null)
  }, [fileId])

  // 桌面端：点外部关闭（移动端走遮罩按钮）
  useEffect(() => {
    if (!open || isMobile) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || sheetRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, isMobile])

  // 移动端 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const shareUrl = token ? `${window.location.origin}/share/${token}` : ''

  // 二维码（切换显示时生成一次）
  useEffect(() => {
    if (!showQr || !shareUrl || qrDataUrl) return
    QRCode.toDataURL(shareUrl, { width: 176, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [showQr, shareUrl, qrDataUrl])

  const toggle = async (next: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const s = await api.setShare(fileId, next)
      setEnabled(s.enabled)
      setToken(s.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.share.operationFailed)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const ok = await copyText(shareUrl)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      setError(t.share.copyFailed)
    }
  }

  const panel = open ? (
    <>
      {/* 开关行 */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t.share.title}</p>
          <p className="text-muted-foreground text-xs">
            {enabled ? t.share.enabledHint : t.share.disabledHint}
          </p>
        </div>
        <Switch checked={enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
      </div>

      {/* 外链区 */}
      {enabled && token && (
        <>
          <div className="mt-3 flex items-center gap-1.5">
            <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-xs">
              {shareUrl}
            </code>
            <Button variant="outline" size="icon" className="size-8 shrink-0" title={t.share.copyLink} onClick={() => void copy()}>
              {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              title={showQr ? t.share.hideQr : t.share.showQr}
              onClick={() => setShowQr((v) => !v)}
            >
              <QrCode className="size-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="size-8 shrink-0" title={t.share.openNewTab} asChild>
              <a href={`/share/${token}`} target="_blank" rel="noreferrer noopener">
                <Link2 className="size-3.5" />
              </a>
            </Button>
          </div>
          {showQr && (
            <div className="mt-3 flex justify-center rounded-md border p-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={t.share.qrAlt} className="size-40 md:size-44" />
              ) : (
                <span className="text-muted-foreground py-10 text-xs">{t.share.generating}</span>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
    </>
  ) : null

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="ghost"
        size="sm"
        className={cn('text-muted-foreground', enabled && 'text-primary')}
        title={enabled ? t.share.enabledTitle : t.share.label}
        onClick={() => setOpen((o) => !o)}
      >
        <Share2 />
        {t.share.label}
      </Button>

      {panel &&
        (isMobile ? (
          // 移动端：遮罩 + 底部浮层，portal 到 body（绕开 header 的 containing block）
          createPortal(
            <>
              <button aria-label={t.share.closePanel} className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
              <div
                ref={sheetRef}
                className="bg-popover text-popover-foreground fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 rounded-xl border p-4 shadow-2xl"
              >
                {panel}
              </div>
            </>,
            document.body,
          )
        ) : (
          // 桌面端：锚定按钮右下角的弹窗
          <div className="bg-popover text-popover-foreground absolute right-0 z-30 mt-2 w-[22rem] rounded-lg border p-3 shadow-lg">
            {panel}
          </div>
        ))}
    </div>
  )
}
