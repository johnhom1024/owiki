import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { api, type GitBackupConfig } from '@/lib/api.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx'

interface GitBackupCardProps {
  vaultId: number
  /** SSE vault.log 事件触发时递增（写入发生 → 备份可能已跑） */
  refreshTick?: number
}

/**
 * Git 远程备份配置卡片（vault 设置页）。
 * 两级开关：全局 feature（SettingsDialog 插件分区）+ 本卡片的 vault 级开关。
 * token 只写不读：服务端回掩码，编辑时留空 = 保持不变。
 */
export function GitBackupCard({ vaultId, refreshTick }: GitBackupCardProps) {
  const { t, lang } = useLang()
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'

  const [cfg, setCfg] = useState<GitBackupConfig | null>(null)
  const [remote, setRemote] = useState('')
  const [branch, setBranch] = useState('')
  const [token, setToken] = useState('')
  const [debounce, setDebounce] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refreshTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getGitBackup(vaultId)
      setCfg(res.data)
      setRemote(res.data.remoteUrl)
      setBranch(res.data.branch)
      setDebounce(String(res.data.debounceSec))
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [vaultId, t])

  useEffect(() => {
    void load()
  }, [load])

  // SSE 触发刷新：debounce 3s 重查（一轮备份跑完状态会变）
  useEffect(() => {
    if (refreshTick === undefined || refreshTick === 0) return
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => void load(), 3000)
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    }
  }, [refreshTick, load])

  const relTime = (iso?: string | null): string => {
    if (!iso) return t.gitBackup.never
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 0) return t.gitBackup.justNow
    const m = Math.floor(diff / 60_000)
    if (m < 1) return t.gitBackup.justNow
    if (m < 60) return fill(t.gitBackup.minutesAgo, { n: m })
    const h = Math.floor(m / 60)
    if (h < 24) return fill(t.gitBackup.hoursAgo, { n: h })
    return new Date(iso).toLocaleDateString(locale)
  }

  const save = useCallback(
    async (opts: { enabled?: boolean } = {}) => {
      setSaving(true)
      setNotice(null)
      setError(null)
      try {
        const body: Record<string, unknown> = {
          remoteUrl: remote.trim(),
          branch: branch.trim() || 'main',
          debounceSec: Number(debounce) || 15,
        }
        if (token.trim()) body.token = token.trim()
        if (opts.enabled !== undefined) body.enabled = opts.enabled
        const res = await api.setGitBackup(vaultId, body)
        setCfg(res.data)
        setToken('') // 明文只写一次
        setNotice(t.gitBackup.saved)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : t.common.saveFailed)
        return false
      } finally {
        setSaving(false)
      }
    },
    [vaultId, remote, branch, debounce, token, t],
  )

  const runNow = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      await api.runGitBackup(vaultId)
      setNotice(t.gitBackup.runStarted)
      // 稍后重查状态
      window.setTimeout(() => void load(), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.gitBackup.runFailed)
    } finally {
      setRunning(false)
    }
  }, [vaultId, load, t])

  if (!Number.isFinite(vaultId)) return null

  const enabled = cfg?.enabled ?? false
  const configured = Boolean(cfg?.remoteUrl)

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUpload className="size-4" /> {t.gitBackup.title}
          {cfg?.status === 'running' && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="size-3 animate-spin" /> {t.gitBackup.statusRunning}
            </Badge>
          )}
          {cfg?.status === 'error' && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="size-3" /> {t.gitBackup.statusError}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t.gitBackup.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <div className="text-muted-foreground text-sm">{t.common.loading}</div>}

        {error && (
          <div className="text-destructive rounded-md border px-3 py-2 text-sm break-all">{error}</div>
        )}
        {notice && !error && (
          <div className="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm">
            {notice}
          </div>
        )}

        {/* 主开关 */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="size-4" /> {t.gitBackup.enable}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{t.gitBackup.enableHint}</p>
          </div>
          <Switch
            checked={enabled}
            disabled={saving || loading}
            aria-label={t.gitBackup.enable}
            onChange={async (e) => {
              const on = e.target.checked
              if (on && !remote.trim()) {
                setError(t.gitBackup.remoteRequired)
                e.target.checked = false
                return
              }
              const ok = await save({ enabled: on })
              if (!ok) e.target.checked = !on
            }}
          />
        </div>

        {/* 配置表单 */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="git-remote">{t.gitBackup.remoteLabel}</Label>
            <Input
              id="git-remote"
              placeholder="https://github.com/user/vault-backup.git"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="git-branch">{t.gitBackup.branchLabel}</Label>
              <Input
                id="git-branch"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="git-debounce">{t.gitBackup.debounceLabel}</Label>
              <Input
                id="git-debounce"
                type="number"
                min={5}
                max={3600}
                value={debounce}
                onChange={(e) => setDebounce(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="git-token">{t.gitBackup.tokenLabel}</Label>
            <Input
              id="git-token"
              type="password"
              placeholder={cfg?.token ? '•••••' : t.gitBackup.tokenPlaceholder}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t.gitBackup.tokenHint}</p>
          </div>
          <Button variant="outline" disabled={saving} onClick={() => void save()}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>

        {/* 状态区 */}
        {cfg && (
          <div className="border-t pt-4">
            <div className="text-muted-foreground grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <GitCommitHorizontal className="size-3.5 shrink-0" />
                {cfg.lastCommitSha ? (
                  <code className="font-mono">{cfg.lastCommitSha.slice(0, 12)}</code>
                ) : (
                  <span>{t.gitBackup.noCommit}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <CloudUpload className="size-3.5 shrink-0" />
                {t.gitBackup.lastPush}: {relTime(cfg.lastPushAt)}
              </div>
              <div className="col-span-full">
                {t.gitBackup.lastRun}: {relTime(cfg.lastRunAt)}
              </div>
              {cfg.lastError && (
                <div className="text-destructive col-span-full break-all">{cfg.lastError}</div>
              )}
            </div>
            {enabled && configured && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={running}
                onClick={() => void runNow()}
              >
                {running ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> {t.gitBackup.running}
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" /> {t.gitBackup.runNow}
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {/* 恢复说明 */}
        <div className="text-muted-foreground flex items-start gap-2 border-t pt-4 text-xs">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{t.gitBackup.restoreHint}</span>
        </div>
      </CardContent>
    </Card>
  )
}
