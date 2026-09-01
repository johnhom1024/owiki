import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Check, Copy, Link2, QrCode, Share2 } from 'lucide-react'
import { api } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'
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
      .catch((e) => setError(e instanceof Error ? e.message : '获取分享状态失败'))
  }, [open, loaded, fileId])

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
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用（如非安全上下文）：退回选中提示
      setError('复制失败，请手动选中复制')
    }
  }

  const panel = open ? (
    <>
      {/* 开关行 */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">对外分享</p>
          <p className="text-muted-foreground text-xs">
            {enabled ? '任何拿到链接的人都能查看这篇文章' : '开启后生成公开链接，无需登录即可查看'}
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
            <Button variant="outline" size="icon" className="size-8 shrink-0" title="复制链接" onClick={() => void copy()}>
              {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              title={showQr ? '收起二维码' : '显示二维码'}
              onClick={() => setShowQr((v) => !v)}
            >
              <QrCode className="size-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="size-8 shrink-0" title="在新标签页打开" asChild>
              <a href={`/share/${token}`} target="_blank" rel="noreferrer noopener">
                <Link2 className="size-3.5" />
              </a>
            </Button>
          </div>
          {showQr && (
            <div className="mt-3 flex justify-center rounded-md border p-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="分享二维码" className="size-40 md:size-44" />
              ) : (
                <span className="text-muted-foreground py-10 text-xs">生成中...</span>
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
        title={enabled ? '分享已开启' : '分享'}
        onClick={() => setOpen((o) => !o)}
      >
        <Share2 />
        分享
      </Button>

      {panel &&
        (isMobile ? (
          // 移动端：遮罩 + 底部浮层，portal 到 body（绕开 header 的 containing block）
          createPortal(
            <>
              <button aria-label="关闭分享面板" className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
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
