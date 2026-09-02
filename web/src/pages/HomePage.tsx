import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, CheckCircle2, FolderPlus, ScrollText } from 'lucide-react'
import { api, type SyncLogEntry, type VaultMeta } from '@/lib/api.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { CreateVaultDialog } from '@/components/CreateVaultDialog.tsx'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function HomePage({
  vaults,
  onRefresh,
}: {
  vaults: VaultMeta[] | null
  onRefresh: () => Promise<void>
}) {
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  // 正在解析路径的动态条目（点击后短暂 loading，防抖动）
  const [resolving, setResolving] = useState<number | null>(null)

  /** 点击动态条目：路径 → 文件 id → 跳详情页 */
  const openActivity = async (entry: SyncLogEntry) => {
    if (!entry.path || entry.action === 'file.delete') return
    setResolving(entry.id)
    try {
      const r = await api.resolveVaultFile(entry.vaultId, entry.path.split(' → ')[0])
      navigate(`/vaults/${entry.vaultId}/files/${r.data.id}`)
    } catch {
      // 文件可能已被删除：不跳转
    } finally {
      setResolving(null)
    }
  }
  // 跨 vault 的最近同步动态（每个 vault 取前几条合并后按时间取最新 8 条）
  const [activity, setActivity] = useState<SyncLogEntry[] | null>(null)

  const locale = lang === 'en' ? 'en-US' : 'zh-CN'

  /** 相对时间：3 秒内「刚刚」，其余按分钟/小时/天粗粒度展示 */
  const relTime = (iso: string): string => {
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
  }

  useEffect(() => {
    let cancelled = false
    if (!vaults || vaults.length === 0) {
      setActivity(null)
      return
    }
    Promise.all(
      vaults.map((v) =>
        api.listVaultLogs(v.id, { limit: 5 }).then((r) => r.data).catch(() => [] as SyncLogEntry[]),
      ),
    ).then((groups) => {
      if (cancelled) return
      const merged = groups
        .flat()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8)
      setActivity(merged)
    })
    return () => {
      cancelled = true
    }
  }, [vaults])

  const totals = useMemo2(vaults)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* 头部：标题 + 新建 */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-bold">{t.home.title}</h1>
          <p className="text-muted-foreground text-sm">
            {fill(t.home.summary, {
              vaults: totals.vaults,
              files: totals.files,
              size: formatSize(totals.size),
            })}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <FolderPlus />
          {t.home.newVault}
        </Button>
      </div>

      {/* 全局统计 */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t.home.statVaults} value={String(totals.vaults)} />
        <StatCard label={t.home.statFiles} value={String(totals.files)} />
        <StatCard label={t.home.statSize} value={formatSize(totals.size)} />
        <StatCard
          label={t.home.statClients}
          value={String(totals.clients)}
          dot={totals.clients > 0 ? 'green' : 'gray'}
        />
      </div>

      {/* Vault 卡片 */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t.nav.vaults}</h2>
      </div>
      {vaults === null && <p className="text-muted-foreground py-20 text-center">{t.common.loading}</p>}
      {vaults?.length === 0 && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center">
          <p className="mb-4">{t.home.emptyTitle}</p>
          <Button onClick={() => setCreating(true)}>
            <FolderPlus />
            {t.home.newVault}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {vaults?.map((v) => (
          <Link key={v.id} to={`/vaults/${v.id}`}>
            <Card className="hover:border-primary/40 hover:shadow-md transition-all">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="size-4 opacity-70" />
                  {v.name}
                </CardTitle>
                <CardDescription>{v.note || '—'}</CardDescription>
                <CardAction>
                  {v.clients > 0 ? (
                    <Badge className="bg-primary">{fill(t.home.online, { n: v.clients })}</Badge>
                  ) : v.authorized ? (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="size-3 text-primary" /> {t.home.authorized}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t.home.unauthorized}</Badge>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {fill(t.home.filesUnit, { n: v.files })} · {formatSize(v.size)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {v.lastSeenAt
                    ? relTime(v.lastSeenAt)
                    : t.home.neverConnected}
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 最近动态 */}
      <div className="mt-8 mb-2 flex items-center gap-2">
        <ScrollText className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">{t.home.activity}</h2>
      </div>
      {activity === null ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{t.home.activityEmpty}</p>
      ) : activity.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{t.home.activityEmpty}</p>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y">
            {activity.map((e) => (
              <ActivityRow
                key={e.id}
                entry={e}
                vaultName={vaults?.find((v) => v.id === e.vaultId)?.name}
                verb={verbOf(e.action, t)}
                relTime={relTime}
                busy={resolving === e.id}
                disabled={!e.path || e.action === 'file.delete'}
                onOpen={() => void openActivity(e)}
              />
            ))}
          </div>
        </Card>
      )}

      <CreateVaultDialog open={creating} onOpenChange={setCreating} onCreated={onRefresh} />
    </div>
  )
}

/** 动作 key → 动词 */
function verbOf(action: string, t: ReturnType<typeof useLang>['t']): string {
  const map: Record<string, string> = {
    'file.create': t.home.verbCreate,
    'file.update': t.home.verbUpdate,
    'file.delete': t.home.verbDelete,
    'file.rename': t.home.verbRename,
    'file.merge': t.home.verbMerge,
    'file.conflict': t.home.verbConflict,
    'file.echo': t.home.verbEcho,
    'device.connect': t.home.verbConnect,
    'device.unbind': t.home.verbUnbind,
    'file.web': t.home.verbWeb,
  }
  return map[action] ?? action
}

/** 单条动态：vault 名 · 动作 · 文件 · 时间（可点击跳详情） */
function ActivityRow({
  entry,
  vaultName,
  verb,
  relTime,
  busy,
  disabled,
  onOpen,
}: {
  entry: SyncLogEntry
  vaultName?: string
  verb: string
  relTime: (iso: string) => string
  busy?: boolean
  disabled?: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled || busy}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm',
        !disabled && 'hover:bg-accent/50 cursor-pointer',
        disabled && 'cursor-default opacity-60',
        busy && 'animate-pulse',
      )}
    >
      <span className="text-muted-foreground w-20 shrink-0 truncate text-xs" title={vaultName}>
        {vaultName ?? `Vault ${entry.vaultId}`}
      </span>
      <span
        className={cn(
          'shrink-0 text-xs font-medium',
          entry.action === 'file.delete' || entry.action === 'file.conflict'
            ? 'text-destructive'
            : entry.action === 'file.merge'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-sky-600 dark:text-sky-400',
        )}
      >
        {verb}
      </span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate" title={entry.path}>
        {entry.path || entry.detail}
      </span>
      <span className="text-muted-foreground/70 shrink-0 text-xs">{relTime(entry.createdAt)}</span>
    </button>
  )
}

function StatCard({
  label,
  value,
  dot,
}: {
  label: string
  value: string
  dot?: 'green' | 'gray'
}) {
  return (
    <Card className={cn('gap-1 py-4')}>
      <div className="text-muted-foreground flex items-center gap-1.5 px-4 text-xs">
        {dot && (
          <span
            className={cn(
              'inline-block size-2 rounded-full',
              dot === 'green' ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          />
        )}
        {label}
      </div>
      <div className="px-4 text-xl font-bold">{value}</div>
    </Card>
  )
}

/** vaults 汇总（null 安全） */
function useMemo2(vaults: VaultMeta[] | null) {
  if (!vaults) return { vaults: 0, files: 0, size: 0, clients: 0 }
  return vaults.reduce(
    (acc, v) => ({
      vaults: vaults.length,
      files: acc.files + v.files,
      size: acc.size + v.size,
      clients: acc.clients + v.clients,
    }),
    { vaults: 0, files: 0, size: 0, clients: 0 },
  )
}
