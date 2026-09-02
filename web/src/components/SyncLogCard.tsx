import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRightLeft,
  CircleAlert,
  CloudUpload,
  FileMinus,
  FilePen,
  FilePlus,
  GitMerge,
  Laptop,
  PlugZap,
  Repeat2,
  ScrollText,
  Unplug,
} from 'lucide-react'
import { api, type SyncLogEntry, type SyncLogFilter } from '@/lib/api.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx'
import { cn } from '@/lib/utils.ts'

interface SyncLogCardProps {
  vaultId: number
  /** SSE vault.log 事件触发时递增；组件据此刷新（仅在设置页挂载时刷新） */
  refreshTick?: number
}

export function SyncLogCard({ vaultId, refreshTick }: SyncLogCardProps) {
  const { t, lang } = useLang()
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'

  const [logs, setLogs] = useState<SyncLogEntry[]>([])
  const [filter, setFilter] = useState<SyncLogFilter>('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshTimer = useRef<number | null>(null)

  /** 动作 → 展示元数据（图标 / 文案 / 颜色） */
  const actionMeta = useCallback((): Record<
    string,
    { icon: typeof FilePlus; verb: string; color: string }
  > => {
    return {
      'file.create': { icon: FilePlus, verb: t.syncLog.create, color: 'text-emerald-600 dark:text-emerald-400' },
      'file.update': { icon: FilePen, verb: t.syncLog.update, color: 'text-sky-600 dark:text-sky-400' },
      'file.delete': { icon: FileMinus, verb: t.syncLog.delete, color: 'text-destructive' },
      'file.rename': { icon: ArrowRightLeft, verb: t.syncLog.rename, color: 'text-violet-600 dark:text-violet-400' },
      'file.merge': { icon: GitMerge, verb: t.syncLog.merge, color: 'text-amber-600 dark:text-amber-400' },
      'file.conflict': { icon: CircleAlert, verb: t.syncLog.conflict, color: 'text-destructive' },
      'file.echo': { icon: Repeat2, verb: t.syncLog.echo, color: 'text-muted-foreground' },
      'device.connect': { icon: PlugZap, verb: t.syncLog.deviceConnect, color: 'text-emerald-600 dark:text-emerald-400' },
      'device.unbind': { icon: Unplug, verb: t.syncLog.deviceUnbind, color: 'text-muted-foreground' },
      'file.web': { icon: CloudUpload, verb: t.syncLog.fileWeb, color: 'text-sky-600 dark:text-sky-400' },
    }
  }, [t])

  /** 过滤 chips */
  const filters: { key: SyncLogFilter; label: string }[] = [
    { key: '', label: t.syncLog.filterAll },
    { key: 'changes', label: t.syncLog.filterChanges },
    { key: 'deletes', label: t.syncLog.filterDeletes },
    { key: 'conflicts', label: t.syncLog.filterConflicts },
  ]

  /** 来源 badge 文案 */
  const sourceLabel = useCallback(
    (s: string) =>
      s === 'ws' ? t.syncLog.sourceWs : s === 'web' ? t.syncLog.sourceWeb : s === 'openapi' ? t.syncLog.sourceOpenapi : s,
    [t],
  )

  /** 相对时间 */
  const relTime = useCallback(
    (iso: string): string => {
      const diff = Date.now() - new Date(iso).getTime()
      if (diff < 0) return t.syncLog.justNow
      const m = Math.floor(diff / 60_000)
      if (m < 1) return t.syncLog.justNow
      if (m < 60) return fill(t.syncLog.minutesAgo, { n: m })
      const h = Math.floor(m / 60)
      if (h < 24) return fill(t.syncLog.hoursAgo, { n: h })
      const d = Math.floor(h / 24)
      if (d < 30) return fill(t.syncLog.daysAgo, { n: d })
      return new Date(iso).toLocaleDateString(locale)
    },
    [t, locale],
  )

  /** 字节数人性化 */
  const humanSize = (n: number): string => {
    if (n <= 0) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }

  const load = useCallback(
    async (opts: { before?: number; append?: boolean } = {}) => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.listVaultLogs(vaultId, {
          before: opts.before,
          limit: 30,
          type: filter,
        })
        setLogs((prev) => (opts.append ? [...prev, ...res.data] : res.data))
        setHasMore(res.hasMore)
      } catch (e) {
        setError(e instanceof Error ? e.message : t.common.loadFailed)
      } finally {
        setLoading(false)
      }
    },
    [vaultId, filter, t],
  )

  // 首次 / 过滤器变化：重置列表
  useEffect(() => {
    void load()
  }, [load])

  // SSE 触发刷新：debounce 1s 重拉第一页，避免高频同步时刷屏
  useEffect(() => {
    if (refreshTick === undefined || refreshTick === 0) return
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => void load(), 1000)
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    }
  }, [refreshTick, load])

  if (!Number.isFinite(vaultId)) return null

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" /> {t.syncLog.title}
        </CardTitle>
        <CardDescription>{t.syncLog.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 过滤 chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                filter === f.key
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2">
            {loading && (
              <span className="text-muted-foreground text-xs">{t.common.loading}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void load()}
              title={t.common.refresh}
            >
              {t.common.refresh}
            </Button>
          </span>
        </div>

        {error && (
          <div className="text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* 时间线 */}
        {!loading && logs.length === 0 && !error && (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <ScrollText className="size-4" />
            {filter === '' ? t.syncLog.empty : t.syncLog.emptyFiltered}
          </div>
        )}

        <div className="divide-y">
          {logs.map((log) => {
            const meta = actionMeta()[log.action] ?? {
              icon: AlertCircle,
              verb: log.action,
              color: 'text-muted-foreground',
            }
            const Icon = meta.icon
            return (
              <div key={log.id} className="flex items-start gap-3 py-2 text-sm">
                <Icon className={cn('mt-0.5 size-4 shrink-0', meta.color)} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={cn('shrink-0 font-medium', meta.color)}>
                      {meta.verb}
                    </span>
                    <span className="min-w-0 break-all font-mono text-[13px]">
                      {log.path || '—'}
                    </span>
                    {log.size > 0 && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {humanSize(log.size)}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                    {log.deviceName && (
                      <span className="inline-flex items-center gap-1">
                        <Laptop className="size-3" />
                        {log.deviceName}
                      </span>
                    )}
                    {log.source && sourceLabel(log.source) && (
                      <Badge variant="secondary" className="px-1.5 text-[10px]">
                        {sourceLabel(log.source)}
                      </Badge>
                    )}
                    {log.detail && <span>{log.detail}</span>}
                    <span title={new Date(log.createdAt).toLocaleString(locale)}>
                      {relTime(log.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {hasMore && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={loading}
            onClick={() => void load({ before: logs[logs.length - 1]?.id, append: true })}
          >
            {loading ? t.common.loading : t.syncLog.loadMore}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
