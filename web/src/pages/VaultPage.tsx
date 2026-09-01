import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileText, Settings2 } from 'lucide-react'
import { api, type FileMeta, type VaultSummary } from '@/lib/api.ts'
import { Button } from '@/components/ui/button.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card } from '@/components/ui/card.tsx'
import { cn } from '@/lib/utils.ts'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function VaultPage({
  syncProgress,
}: {
  syncProgress?: Record<number, { total: number; done: number }>
}) {
  const { vid } = useParams()
  const navigate = useNavigate()
  const vaultId = Number(vid)
  const progress = syncProgress?.[vaultId]

  const [vault, setVault] = useState<VaultSummary | null>(null)
  const [files, setFiles] = useState<FileMeta[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!Number.isFinite(vaultId)) return
    setError(null)
    try {
      const [v, f] = await Promise.all([
        api.getVault(vaultId),
        api.listVaultFiles(vaultId),
      ])
      setVault(v)
      setFiles(f.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [vaultId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(t)
  }, [refresh])

  // 浏览器标题：OWiki · vault 名
  useEffect(() => {
    if (vault?.data.name) document.title = `OWiki · ${vault.data.name}`
    return () => {
      document.title = 'OWiki'
    }
  }, [vault?.data.name])

  const recentFiles = useMemo(() => {
    return [...files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10)
  }, [files])

  if (!Number.isFinite(vaultId)) {
    return <div className="p-8 text-destructive">无效的 vault id</div>
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {vault?.data.name ?? '...'}
            {vault && progress && progress.done < progress.total ? (
              <Badge className="bg-primary">同步中</Badge>
            ) : vault && vault.clients > 0 ? (
              <Badge variant="secondary">{vault.clients} 在线</Badge>
            ) : null}
            {vault?.authorized && <Badge variant="secondary">已授权</Badge>}
          </h1>
          {vault?.data.note && (
            <p className="text-muted-foreground mt-0.5 text-sm">{vault.data.note}</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => navigate(`/vaults/${vaultId}/settings`)}
        >
          <Settings2 /> 设置
        </Button>
      </div>

      {/* 同步进度条 */}
      {progress && progress.done < progress.total && (
        <div className="mb-4 rounded-md border px-4 py-3 text-sm">
          <div className="text-muted-foreground mb-1 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
              正在同步
            </span>
            <span>
              {progress.done} / {progress.total}（{Math.floor((progress.done / progress.total) * 100)}%）
            </span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${Math.floor((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      {vault && (
        <div className="mb-8 grid grid-cols-3 gap-3">
          <StatCard label="文件总数" value={String(vault.stats.totalFiles)} />
          <StatCard label="总大小" value={formatSize(vault.stats.totalSize)} />
          <StatCard
            label="在线连接"
            value={String(vault.clients)}
            dot={vault.clients > 0 ? 'green' : 'gray'}
          />
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 text-destructive mb-4 rounded-md border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* 最近更新 */}
      <h2 className="text-muted-foreground mb-3 text-sm font-semibold">最近更新</h2>
      {vault === null && !error ? (
        <p className="text-muted-foreground py-12 text-center text-sm">加载中...</p>
      ) : recentFiles.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          还没有同步任何文件——去设置页连接 Obsidian
        </p>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y">
            {recentFiles.map((f) => (
              <button
                key={f.id}
                onClick={() => navigate(`/vaults/${vaultId}/files/${f.id}`)}
                className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
              >
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{f.path}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{formatSize(f.size)}</span>
                <span className="text-muted-foreground/70 shrink-0 text-xs">
                  {new Date(f.updatedAt).toLocaleString('zh-CN')}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
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
      <div className="px-4 text-2xl font-bold">{value}</div>
    </Card>
  )
}
