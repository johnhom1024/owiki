import { useCallback, useEffect, useState } from 'react'
import { ArchiveRestore, FileWarning, Loader2 } from 'lucide-react'
import { api } from '@/lib/api.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'

interface RestoreDialogProps {
  vaultId: number
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 恢复成功后回调（刷新卡片状态等） */
  onRestored?: () => void
}

/**
 * 从 Git 备份恢复：diff 远程（或护底分支）vs DB → 勾选 → 写回。
 * 只列出有差异的文件；恢复走正常写入路径，Obsidian 实时收到。
 */
export function GitBackupRestoreDialog({ vaultId, open, onOpenChange, onRestored }: RestoreDialogProps) {
  const { t } = useLang()

  const [from, setFrom] = useState('') // 空 = 目标分支；owiki/diverged-* = 护底分支
  const [diff, setDiff] = useState<Awaited<ReturnType<typeof api.restoreDiffGitBackup>>['data'] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    setDone(null)
    try {
      const res = await api.restoreDiffGitBackup(vaultId, from || undefined)
      setDiff(res.data)
      setSelected(new Set(res.data.items.map((it) => it.path)))
    } catch (e) {
      setError(e instanceof Error ? e.message : t.gitBackup.restoreFailed)
    } finally {
      setScanning(false)
    }
  }, [vaultId, from, t])

  useEffect(() => {
    if (open) void scan()
  }, [open, scan])

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const apply = useCallback(async () => {
    setApplying(true)
    setError(null)
    try {
      const res = await api.restoreApplyGitBackup(vaultId, {
        from: from || undefined,
        mode: 'selected',
        paths: [...selected],
      })
      setDone(fill(t.gitBackup.restoreApplied, { n: String(res.data.applied) }))
      onRestored?.()
      void scan() // 刷新差异清单（恢复过的应从列表消失）
    } catch (e) {
      setError(e instanceof Error ? e.message : t.gitBackup.restoreFailed)
    } finally {
      setApplying(false)
    }
  }, [vaultId, from, selected, onRestored, scan, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArchiveRestore className="size-4" /> {t.gitBackup.restoreTitle}
          </DialogTitle>
          <DialogDescription className="text-left">{t.gitBackup.restoreDesc}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive rounded-md border px-3 py-2 text-sm break-all">{error}</div>
        )}
        {done && !error && (
          <div className="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm">{done}</div>
        )}

        {/* 恢复来源：目标分支 / 护底分支 */}
        <div className="space-y-2">
          <Label htmlFor="restore-from">{t.gitBackup.restoreRefLabel}</Label>
          <Input
            id="restore-from"
            placeholder={t.gitBackup.restoreRefBranch}
            value={from}
            onChange={(e) => setFrom(e.target.value.trim())}
            onBlur={() => void scan()}
          />
          <p className="text-muted-foreground text-xs">{t.gitBackup.restoreDialogHint}</p>
        </div>

        {/* 差异清单 */}
        <div className="min-h-24 space-y-2">
          {scanning && (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" /> {t.gitBackup.restoreScanning}
            </div>
          )}
          {!scanning && diff && diff.items.length === 0 && (
            <div className="text-muted-foreground py-6 text-center text-sm">{t.gitBackup.restoreEmpty}</div>
          )}
          {!scanning && diff && diff.items.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  {diff.total} · {diff.remoteShort}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected((prev) =>
                      prev.size === diff.items.length
                        ? new Set()
                        : new Set(diff.items.map((it) => it.path)),
                    )
                  }
                >
                  {t.gitBackup.restoreSelectAll}
                </Button>
              </div>
              <div className="divide-y rounded-md border">
                {diff.items.map((it) => (
                  <label
                    key={it.path}
                    className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(it.path)}
                      onChange={() => toggle(it.path)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs" title={it.path}>
                        {it.path}
                      </div>
                      <div
                        className={
                          it.type === 'remote-only'
                            ? 'text-muted-foreground text-xs'
                            : 'text-amber-600 dark:text-amber-400 text-xs'
                        }
                      >
                        {it.type === 'remote-only' ? t.gitBackup.restoreRemoteOnly : t.gitBackup.restoreDiffers}
                      </div>
                    </div>
                    {it.type === 'differs' && <FileWarning className="mt-0.5 size-3.5 shrink-0 text-amber-500" />}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button disabled={applying || selected.size === 0} onClick={() => void apply()}>
            {applying ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> {t.common.saving}
              </>
            ) : (
              fill(t.gitBackup.restoreApply, { n: String(selected.size) })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
