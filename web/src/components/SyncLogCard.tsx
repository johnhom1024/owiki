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

/** 动作 → 展示元数据（图标 / 文案模板 / 颜色） */
const ACTION_META: Record<
  string,
  { icon: typeof FilePlus; verb: string; color: string; label: string }
> = {
  'file.create': { icon: FilePlus, verb: '新增', color: 'text-emerald-600 dark:text-emerald-400', label: '新增' },
  'file.update': { icon: FilePen, verb: '更新', color: 'text-sky-600 dark:text-sky-400', label: '更新' },
  'file.delete': { icon: FileMinus, verb: '删除', color: 'text-destructive', label: '删除' },
  'file.rename': { icon: ArrowRightLeft, verb: '重命名', color: 'text-violet-600 dark:text-violet-400', label: '重命名' },
  'file.merge': { icon: GitMerge, verb: '合并', color: 'text-amber-600 dark:text-amber-400', label: '合并' },
  'file.conflict': { icon: CircleAlert, verb: '冲突', color: 'text-destructive', label: '冲突' },
  'file.echo': { icon: Repeat2, verb: '回声', color: 'text-muted-foreground', label: '回声' },
  'device.connect': { icon: PlugZap, verb: '连接', color: 'text-emerald-600 dark:text-emerald-400', label: '设备连接' },
  'device.unbind': { icon: Unplug, verb: '解绑', color: 'text-muted-foreground', label: '设备解绑' },
  'file.web': { icon: CloudUpload, verb: '网页编辑', color: 'text-sky-600 dark:text-sky-400', label: '网页编辑' },
}

/** 相对时间：3 秒内「刚刚」，其余按分钟/小时/天粗粒度展示 */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

/** 字节数人性化 */
function humanSize(n: number): string {
  if (n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 来源 badge 文案 */
const SOURCE_LABEL: Record<string, string> = {
  ws: '插件',
  web: '网页',
  openapi: 'API',
}

interface SyncLogCardProps {
  vaultId: number
  /** SSE vault.log 事件触发时递增；组件据此刷新（仅在设置页挂载时刷新） */
  refreshTick?: number
}

const FILTERS: { key: SyncLogFilter; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'changes', label: '文件变更' },
  { key: 'deletes', label: '删除' },
  { key: 'conflicts', label: '冲突与合并' },
]

export function SyncLogCard({ vaultId, refreshTick }: SyncLogCardProps) {
  const [logs, setLogs] = useState<SyncLogEntry[]>([])
  const [filter, setFilter] = useState<SyncLogFilter>('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshTimer = useRef<number | null>(null)

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
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    },
    [vaultId, filter],
  )

  // 首次 / 过滤器变化：重置列表
  useEffect(() => {
    void load()
  }, [load])

  // SSE 触发刷新：debounce 1s 重拉第一页，避免高频同步时刷屏。
  // 重拉第一页会丢掉用户翻页的位置，但同步日志场景下「最新在上」更重要
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
          <ScrollText className="size-4" /> 同步日志
        </CardTitle>
        <CardDescription>
          每次新增/更新/删除/冲突的同步记录，按时间倒序，保留 30 天
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 过滤 chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
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
              <span className="text-muted-foreground text-xs">加载中…</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void load()}
              title="刷新"
            >
              刷新
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
            {filter === '' ? '暂无同步记录' : '该过滤条件下没有记录'}
          </div>
        )}

        <div className="divide-y">
          {logs.map((log) => {
            const meta = ACTION_META[log.action] ?? {
              icon: AlertCircle,
              verb: log.action,
              color: 'text-muted-foreground',
              label: log.action,
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
                    {log.source && SOURCE_LABEL[log.source] && (
                      <Badge variant="secondary" className="px-1.5 text-[10px]">
                        {SOURCE_LABEL[log.source]}
                      </Badge>
                    )}
                    {log.detail && <span>{log.detail}</span>}
                    <span title={new Date(log.createdAt).toLocaleString('zh-CN')}>
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
            {loading ? '加载中…' : '加载更多'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
