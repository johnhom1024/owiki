import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Laptop,
  MonitorCheck,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { api, type VaultDetail, type VaultDevice, type VaultTokenInfo } from '@/lib/api.ts'
import { useFeatures } from '@/lib/features.tsx'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { SyncLogCard } from '@/components/SyncLogCard.tsx'
import { GitBackupCard } from '@/components/GitBackupCard.tsx'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'

interface VaultSettingsPageProps {
  /** SSE 事件触发时递增；订阅它的 useEffect 会重查本页数据 */
  refreshTick?: number
  /** 同步日志刷新 tick（vaultId -> 次数）：SSE vault.log 事件驱动，SyncLogCard 据此刷新 */
  logRefreshTicks?: Record<number, number>
  /** 保存基本信息/删除 vault 后通知 App 重查 vault 列表（首页卡片与侧栏展示 note） */
  onRefresh?: () => Promise<void>
}

/**
 * 服务端按请求头（X-Forwarded-Proto 等）推 ws 地址，但生产链路有多层反代
 * （Traefik → frp → …），该头可能在中间被覆盖丢失，导致 https 页面拿到 ws://。
 * 这里以当前页面协议为最终依据做修正：页面是 https 时，把 serverUrl 和
 * obsidianOAuth 深链里的 server 参数统一升级成 wss://；http 页面维持 ws:// 不动。
 */
function upgradeToPageScheme(info: VaultTokenInfo | null): VaultTokenInfo | null {
  if (!info || window.location.protocol !== 'https:') return info
  const serverUrl = info.serverUrl.replace(/^ws:\/\//i, 'wss://')
  if (serverUrl === info.serverUrl) return info
  // obsidianOAuth 深链里 server= 的值是 encodeURIComponent 后的同一个地址，原位替换
  const encoded = encodeURIComponent(info.serverUrl)
  const obsidianOAuth = info.obsidianOAuth.includes(encoded)
    ? info.obsidianOAuth.replace(encoded, encodeURIComponent(serverUrl))
    : info.obsidianOAuth
  return { ...info, serverUrl, obsidianOAuth }
}

export function VaultSettingsPage({ refreshTick, logRefreshTicks, onRefresh }: VaultSettingsPageProps = {}) {
  const { vid } = useParams()
  const { t, lang } = useLang()
  const { isEnabled: featureEnabled } = useFeatures()
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'
  const navigate = useNavigate()
  const vaultId = Number(vid)

  const [vault, setVault] = useState<VaultDetail | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [fetchedTokenInfo, setTokenInfo] = useState<VaultTokenInfo | null>(null)
  /** 展示 / 唤起 Obsidian 前按页面协议修正 ws 前缀（见 upgradeToPageScheme 注释） */
  const tokenInfo = useMemo(() => upgradeToPageScheme(fetchedTokenInfo), [fetchedTokenInfo])
  const [devices, setDevices] = useState<VaultDevice[]>([])
  // ---------- 单设备同步 ----------
  const [singleDevice, setSingleDevice] = useState(false)
  const [pinnedId, setPinnedId] = useState('')
  const [sdDraft, setSdDraft] = useState<{ on: boolean; deviceId: string } | null>(null) // 开关确认弹窗
  const [sdDraftId, setSdDraftId] = useState('') // 下拉框草稿值（select 受控用）
  const [sdSaving, setSdSaving] = useState(false)
  /** 点击复制设备 ID 后短暂标记，切换复制图标 */
  const [copiedDeviceId, setCopiedDeviceId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isFinite(vaultId)) return
    try {
      const [v, t] = await Promise.all([
        api.getVault(vaultId),
        api.getVaultToken(vaultId),
      ])
      setVault(v.data)
      setName(v.data.name)
      setNote(v.data.note)
      setSingleDevice(!!v.data.singleDevice)
      setPinnedId(v.data.pinnedDeviceId ?? '')
      setSdDraftId(v.data.pinnedDeviceId ?? '')
      setAuthorized(v.authorized)
      setLastSeenAt(v.lastSeenAt)
      setTokenInfo(t)
      // 设备列表一并拉取
      try {
        const d = await api.listVaultDevices(vaultId)
        setDevices(d.data)
      } catch {
        setDevices([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.loadFailed)
    }
  }, [vaultId])

  useEffect(() => {
    void load()
  }, [load])

  // 订阅全局 vault 事件：refreshTick++ 时重查本页面（避免 vault 列表已变但
  // 设置页还显示旧授权状态）
  useEffect(() => {
    void load()
  }, [refreshTick, load])

  const save = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await api.updateVault(vaultId, { name: name.trim(), note: note.trim() })
      setNotice(t.vaultSettings.saved)
      await load()
      // 首页卡片与侧栏展示 note/name，重查列表让改动立刻可见
      await onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const rotate = async () => {
    setError(null)
    try {
      const ti = await api.rotateVaultToken(vaultId)
      setTokenInfo(ti)
      setNotice(t.vaultSettings.rotateNotice)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.loadFailed)
    }
  }

  /** 取消授权：作废令牌 + 清除授权状态 + 踢掉在线连接 */
  const revoke = async () => {
    setRevoking(true)
    setError(null)
    setNotice(null)
    try {
      await api.revokeVault(vaultId)
      setAuthorized(false)
      setLastSeenAt('')
      setDevices([])
      // 设备记录与单设备 pin 均已被服务端清掉
      setSingleDevice(false)
      setPinnedId('')
      setSdDraftId('')
      // 令牌已被服务端作废，重新拉取新令牌供下次授权
      const ti = await api.getVaultToken(vaultId)
      setTokenInfo(ti)
      setNotice(t.vaultSettings.revoked)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.vaultSettings.revokeFailed)
    } finally {
      setRevoking(false)
    }
  }

  /** 单设备同步：保存开关与选定设备 */
  const saveSingleDevice = async (on: boolean, deviceId: string) => {
    setSdSaving(true)
    setError(null)
    setNotice(null)
    try {
      await api.setSingleDevice(vaultId, { singleDevice: on, pinnedDeviceId: on ? deviceId : '' })
      setSingleDevice(on)
      setPinnedId(on ? deviceId : '')
      const devName = devices.find((d) => d.deviceId === deviceId)?.deviceName || t.vaultSettings.selectedDevice
      setNotice(
        on
          ? fill(t.vaultSettings.sdOnNotice, { name: devName })
          : t.vaultSettings.sdOffNotice,
      )
      setSdDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.saveFailed)
    } finally {
      setSdSaving(false)
    }
  }

  /** 复制设备 ID 到剪贴板，短暂显示已复制状态 */
  const copyDeviceId = async (deviceId: string) => {
    try {
      await navigator.clipboard.writeText(deviceId)
      setCopiedDeviceId(deviceId)
      setTimeout(() => setCopiedDeviceId(null), 1500)
    } catch {
      // 剪贴板不可用（非 https/权限拒绝）时静默失败
    }
  }

  const remove = async () => {
    try {
      await api.deleteVault(vaultId)
      await onRefresh?.()
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.deleteFailed)
    }
  }

  /** 一键授权：跳转 obsidian:// 深链，插件会自动写入 serverUrl + token 并连接 */
  const authorizeObsidian = () => {
    if (!tokenInfo) return
    window.location.href = tokenInfo.obsidianOAuth
    setNotice(t.vaultSettings.obsidianLaunched)
  }

  if (!Number.isFinite(vaultId)) {
    return <div className="p-8 text-destructive">{t.vaultSettings.invalidId}</div>
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft /> {t.common.back}
      </Button>
      <h1 className="mb-6 text-2xl font-bold">{t.vaultSettings.title}</h1>

      {notice && (
        <div className="mb-4 rounded-md border border-primary/25 bg-primary/10 px-4 py-3 text-sm">
          {notice}
        </div>
      )}
      {error && (
        <div className="bg-destructive/10 text-destructive mb-4 rounded-md border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* 基本信息 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t.vaultSettings.basicInfo}</CardTitle>
          <CardDescription>{t.vaultSettings.basicInfoDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t.vaultSettings.nameLabel}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">{t.vaultSettings.noteLabel}</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </CardContent>
      </Card>

      {/* 同步 Obsidian */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> {t.vaultSettings.syncObsidian}
            {authorized ? (
              <Badge className="bg-primary">
                <CheckCircle2 className="size-3" /> {t.vaultSettings.authorized}
              </Badge>
            ) : (
              <Badge variant="secondary">{t.vaultSettings.unauthorized}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {authorized
              ? t.vaultSettings.pairedDesc + (lastSeenAt ? fill(t.vaultSettings.lastSeenAt, { t: lastSeenAt }) : '')
              : t.vaultSettings.unpairedDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authorized ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-primary" />
                {lastSeenAt
                  ? fill(t.vaultSettings.pairedAt, { t: lastSeenAt })
                  : t.vaultSettings.pairedNoTime}
              </p>
              <Button variant="outline" size="sm" onClick={authorizeObsidian} disabled={!tokenInfo}>
                <ExternalLink /> {t.vaultSettings.reauthorize}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={revoking}
                onClick={() => setConfirmRevoke(true)}
              >
                <Ban /> {revoking ? t.vaultSettings.revoking : t.vaultSettings.revoke}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button onClick={authorizeObsidian} disabled={!tokenInfo}>
                <ExternalLink /> {t.vaultSettings.oneClickAuth}
              </Button>
              <span className="text-muted-foreground text-xs">
                {t.vaultSettings.oneClickHint}
              </span>
            </div>
          )}

          <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{fill(t.vaultSettings.confirmRevokeTitle, { name: vault?.name ?? '' })}</DialogTitle>
                <DialogDescription>
                  {t.vaultSettings.confirmRevokeDesc}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmRevoke(false)}>
                  {t.vaultSettings.thinkAgain}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmRevoke(false)
                    void revoke()
                  }}
                >
                  {t.vaultSettings.confirmRevoke}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 已授权设备列表 + 单设备同步 */}
          {devices.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{fill(t.vaultSettings.authorizedDevices, { n: devices.length })}</Label>
                <div className="divide-y rounded-md border">
                  {devices.map((d) => {
                    const isPinned = singleDevice && d.deviceId === pinnedId
                    return (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Laptop className="text-muted-foreground size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{d.deviceName || t.vaultSettings.unnamedDevice}</span>
                            {d.clientVersion && (
                              // 客户端插件版本：诊断兼容性时一眼看清每台设备在用哪个版本
                              <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                                v{d.clientVersion}
                              </span>
                            )}
                            {isPinned && (
                              <Badge className="shrink-0">
                                <MonitorCheck className="size-3" /> {t.vaultSettings.syncDevice}
                              </Badge>
                            )}
                            {singleDevice && !isPinned && (
                              <Badge variant="secondary" className="shrink-0">
                                {t.vaultSettings.nonSyncDevice}
                              </Badge>
                            )}
                          </div>
                          {/* 设备 ID：核对/配置单设备同步时需要，点击复制 */}
                          <button
                            type="button"
                            className="group/id text-muted-foreground hover:text-foreground mt-0.5 flex max-w-full items-center gap-1 text-left font-mono text-xs break-all"
                            onClick={() => void copyDeviceId(d.deviceId)}
                            title={t.vaultSettings.copyDeviceId}
                          >
                            <span>{d.deviceId}</span>
                            {copiedDeviceId === d.deviceId ? (
                              <CheckCircle2 className="text-primary size-3 shrink-0" />
                            ) : (
                              <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/id:opacity-100" />
                            )}
                          </button>
                          <div className="text-muted-foreground truncate text-xs">
                            {fill(t.vaultSettings.lastOnline, { t: new Date(d.lastSeenAt).toLocaleString(locale) })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 单设备同步：总开关 + 选定设备 */}
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  {/* 描述区必须 flex-1 + min-w-0，否则长描述会撑开并把 Switch 挤出可视区 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <MonitorCheck className="size-4" /> {t.vaultSettings.singleDevice}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.vaultSettings.singleDeviceDesc}
                    </p>
                  </div>
                  <Switch
                    checked={singleDevice}
                    disabled={sdSaving || devices.length === 0}
                    aria-label={t.vaultSettings.singleDevice}
                    onChange={(e) => {
                      const on = e.target.checked
                      // 首次开启默认 pin 最近在线的设备（列表第一台），走确认弹窗
                      setSdDraft({ on, deviceId: on ? pinnedId || devices[0].deviceId : '' })
                    }}
                  />
                </div>

                {singleDevice && (
                  <div className="space-y-2">
                    <Label htmlFor="single-device-select">{t.vaultSettings.singleDeviceSelect}</Label>
                    <div className="flex items-center gap-2">
                      <select
                        id="single-device-select"
                        className="border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm shadow-xs outline-none"
                        value={devices.some((d) => d.deviceId === sdDraftId) ? sdDraftId : pinnedId}
                        disabled={sdSaving}
                        onChange={(e) => {
                          setSdDraftId(e.target.value)
                          // 切换设备同样走确认弹窗：原设备连接会被断开
                          setSdDraft({ on: true, deviceId: e.target.value })
                        }}
                      >
                        {devices.map((d) => (
                          <option key={d.id} value={d.deviceId}>
                            {d.deviceName || t.vaultSettings.unnamedDevice}（{d.deviceId.slice(0, 8)}…）
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t.vaultSettings.singleDeviceSwitchHint}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 单设备同步 开/关/切换 的确认弹窗 */}
          <Dialog open={sdDraft !== null} onOpenChange={(o) => !o && setSdDraft(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {sdDraft?.on ? t.vaultSettings.confirmSdOnTitle : t.vaultSettings.confirmSdOffTitle}
                </DialogTitle>
                <DialogDescription>
                  {sdDraft?.on
                    ? fill(t.vaultSettings.confirmSdOnDesc, {
                        name:
                          devices.find((d) => d.deviceId === sdDraft?.deviceId)?.deviceName ||
                          t.vaultSettings.selectedDevice,
                      })
                    : t.vaultSettings.confirmSdOffDesc}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSdDraft(null)} disabled={sdSaving}>
                  {t.vaultSettings.thinkAgain}
                </Button>
                <Button
                  onClick={() => {
                    if (sdDraft) void saveSingleDevice(sdDraft.on, sdDraft.deviceId)
                  }}
                  disabled={sdSaving}
                >
                  {sdSaving ? t.common.saving : t.common.confirm}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="space-y-2">
            <Label>{t.vaultSettings.serverUrl}</Label>
            <code className="bg-muted block truncate rounded-md px-3 py-2 text-sm">
              {tokenInfo?.serverUrl ?? '...'}
            </code>
          </div>
          <div className="space-y-2">
            <Label>{t.vaultSettings.syncToken}</Label>
            <div className="flex items-center gap-2">
              <code className="bg-muted block flex-1 truncate rounded-md px-3 py-2 font-mono text-sm">
                {tokenInfo?.token ?? '...'}
              </code>
              <Button variant="outline" size="icon" onClick={() => void rotate()} title={t.vaultSettings.rotateToken}>
                <RefreshCw />
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {t.vaultSettings.rotateDesc}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Git 远程备份：vault 级配置（gitbackup feature 关闭时隐藏） */}
      {featureEnabled('gitbackup') && (
        <GitBackupCard vaultId={vaultId} refreshTick={logRefreshTicks?.[vaultId] ?? 0} />
      )}

      {/* 同步日志：新增/更新/删除/冲突的时间线，SSE 实时刷新（synclog feature 关闭时隐藏） */}
      {featureEnabled('synclog') && (
        <SyncLogCard vaultId={vaultId} refreshTick={logRefreshTicks?.[vaultId] ?? 0} />
      )}

      {/* 危险区 */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">{t.vaultSettings.dangerZone}</CardTitle>
          <CardDescription>
            {t.vaultSettings.dangerDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> {t.vaultSettings.deleteVault}
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{fill(t.vaultSettings.confirmDeleteTitle, { name: vault?.name ?? '' })}</DialogTitle>
                <DialogDescription>
                  {t.vaultSettings.confirmDeleteDesc}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                  {t.common.cancel}
                </Button>
                <Button variant="destructive" onClick={() => void remove()}>
                  {t.vaultSettings.confirmDelete}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}
