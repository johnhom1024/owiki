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
import { SyncLogCard } from '@/components/SyncLogCard.tsx'
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
      setError(e instanceof Error ? e.message : '加载失败')
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
      setNotice('已保存')
      await load()
      // 首页卡片与侧栏展示 note/name，重查列表让改动立刻可见
      await onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const rotate = async () => {
    setError(null)
    try {
      const t = await api.rotateVaultToken(vaultId)
      setTokenInfo(t)
      setNotice('令牌已重置，旧连接将失效')
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置失败')
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
      const t = await api.getVaultToken(vaultId)
      setTokenInfo(t)
      setNotice('已取消授权，Obsidian 的连接已被断开')
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消授权失败')
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
      setNotice(
        on
          ? `已开启单设备同步，此后只有「${devices.find((d) => d.deviceId === deviceId)?.deviceName || '所选设备'}」同步本 vault 的文件`
          : '已关闭单设备同步，所有已授权设备恢复同步',
      )
      setSdDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
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
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  /** 一键授权：跳转 obsidian:// 深链，插件会自动写入 serverUrl + token 并连接 */
  const authorizeObsidian = () => {
    if (!tokenInfo) return
    window.location.href = tokenInfo.obsidianOAuth
    setNotice('已唤起 Obsidian，请回到 Obsidian 确认授权')
  }

  if (!Number.isFinite(vaultId)) {
    return <div className="p-8 text-destructive">无效的 vault id</div>
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft /> 返回
      </Button>
      <h1 className="mb-6 text-2xl font-bold">vault 设置</h1>

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
          <CardTitle>基本信息</CardTitle>
          <CardDescription>vault 的名称与备注</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">名称</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">备注</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </CardContent>
      </Card>

      {/* 同步 Obsidian */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> 同步 Obsidian
            {authorized ? (
              <Badge className="bg-primary">
                <CheckCircle2 className="size-3" /> 已授权
              </Badge>
            ) : (
              <Badge variant="secondary">未授权</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {authorized
              ? `Obsidian 已配对连接过${lastSeenAt ? `，最近一次连接：${lastSeenAt}` : ''}`
              : '在装了 owiki-sync 插件的 Obsidian 里授权连接这个 vault'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authorized ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-primary" />
                {lastSeenAt
                  ? `已于 ${lastSeenAt} 完成配对，最近连接正常`
                  : '已完成配对'}
              </p>
              <Button variant="outline" size="sm" onClick={authorizeObsidian} disabled={!tokenInfo}>
                <ExternalLink /> 重新授权
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={revoking}
                onClick={() => setConfirmRevoke(true)}
              >
                <Ban /> {revoking ? '取消中...' : '取消授权'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button onClick={authorizeObsidian} disabled={!tokenInfo}>
                <ExternalLink /> 一键授权连接 Obsidian
              </Button>
              <span className="text-muted-foreground text-xs">
                点击后会唤起 Obsidian 并自动完成配置
              </span>
            </div>
          )}

          <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认取消「{vault?.name}」的授权？</DialogTitle>
                <DialogDescription>
                  取消后：同步令牌立即作废，所有已授权设备的连接会被断开，双方数据保留但不再同步。需要重新授权后才能恢复。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmRevoke(false)}>
                  再想想
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmRevoke(false)
                    void revoke()
                  }}
                >
                  确认取消授权
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 已授权设备列表 + 单设备同步 */}
          {devices.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>已授权设备（{devices.length}）</Label>
                <div className="divide-y rounded-md border">
                  {devices.map((d) => {
                    const isPinned = singleDevice && d.deviceId === pinnedId
                    return (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Laptop className="text-muted-foreground size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{d.deviceName || '未命名设备'}</span>
                            {d.clientVersion && (
                              // 客户端插件版本：诊断兼容性时一眼看清每台设备在用哪个版本
                              <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                                v{d.clientVersion}
                              </span>
                            )}
                            {isPinned && (
                              <Badge className="shrink-0">
                                <MonitorCheck className="size-3" /> 同步设备
                              </Badge>
                            )}
                            {singleDevice && !isPinned && (
                              <Badge variant="secondary" className="shrink-0">
                                非同步设备
                              </Badge>
                            )}
                          </div>
                          {/* 设备 ID：核对/配置单设备同步时需要，点击复制 */}
                          <button
                            type="button"
                            className="group/id text-muted-foreground hover:text-foreground mt-0.5 flex max-w-full items-center gap-1 text-left font-mono text-xs break-all"
                            onClick={() => void copyDeviceId(d.deviceId)}
                            title="点击复制设备 ID"
                          >
                            <span>{d.deviceId}</span>
                            {copiedDeviceId === d.deviceId ? (
                              <CheckCircle2 className="text-primary size-3 shrink-0" />
                            ) : (
                              <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/id:opacity-100" />
                            )}
                          </button>
                          <div className="text-muted-foreground truncate text-xs">
                            最近在线 {new Date(d.lastSeenAt).toLocaleString('zh-CN')}
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
                      <MonitorCheck className="size-4" /> 单设备同步
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      开启后只有选定的那一台设备会同步文件：其他设备仍可连接授权（出现在列表中，随时可切换为同步设备），
                      但其文件变更不会被同步。适合多台机器已由 iCloud 等网盘同步、只想让一台设备上传服务器的场景。
                    </p>
                  </div>
                  <Switch
                    checked={singleDevice}
                    disabled={sdSaving || devices.length === 0}
                    aria-label="单设备同步开关"
                    onChange={(e) => {
                      const on = e.target.checked
                      // 首次开启默认 pin 最近在线的设备（列表第一台），走确认弹窗
                      setSdDraft({ on, deviceId: on ? pinnedId || devices[0].deviceId : '' })
                    }}
                  />
                </div>

                {singleDevice && (
                  <div className="space-y-2">
                    <Label htmlFor="single-device-select">作为同步设备的设备</Label>
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
                            {d.deviceName || '未命名设备'}（{d.deviceId.slice(0, 8)}…）
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      切换后原设备立即停止同步（连接保持，其上会提示「非同步设备」），新选定的设备自动开始同步。
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
                  {sdDraft?.on ? '开启单设备同步？' : '关闭单设备同步？'}
                </DialogTitle>
                <DialogDescription>
                  {sdDraft?.on
                    ? `开启后只有「${
                        devices.find((d) => d.deviceId === sdDraft?.deviceId)?.deviceName || '所选设备'
                      }」会同步本 vault 的文件：其他设备连接保持，但其修改不会被同步（其上会显示「非同步设备」）。`
                    : '关闭后所有已授权设备恢复同步。'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSdDraft(null)} disabled={sdSaving}>
                  再想想
                </Button>
                <Button
                  onClick={() => {
                    if (sdDraft) void saveSingleDevice(sdDraft.on, sdDraft.deviceId)
                  }}
                  disabled={sdSaving}
                >
                  {sdSaving ? '保存中...' : '确认'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="space-y-2">
            <Label>服务器地址（手动配置用）</Label>
            <code className="bg-muted block truncate rounded-md px-3 py-2 text-sm">
              {tokenInfo?.serverUrl ?? '...'}
            </code>
          </div>
          <div className="space-y-2">
            <Label>同步令牌</Label>
            <div className="flex items-center gap-2">
              <code className="bg-muted block flex-1 truncate rounded-md px-3 py-2 font-mono text-sm">
                {tokenInfo?.token ?? '...'}
              </code>
              <Button variant="outline" size="icon" onClick={() => void rotate()} title="重置令牌">
                <RefreshCw />
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              重置后旧令牌立即失效，所有已连接的客户端需要重新授权
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 同步日志：新增/更新/删除/冲突的时间线，SSE 实时刷新 */}
      <SyncLogCard vaultId={vaultId} refreshTick={logRefreshTicks?.[vaultId] ?? 0} />

      {/* 危险区 */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">删除 vault</CardTitle>
          <CardDescription>
            删除后该 vault 的全部笔记（{vault ? '含已同步文件' : ''}）都会被清除，不可恢复
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> 删除这个 vault
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认删除「{vault?.name}」？</DialogTitle>
                <DialogDescription>
                  该 vault 的所有笔记数据将从服务器上永久删除。Obsidian 本地文件不受影响。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
                <Button variant="destructive" onClick={() => void remove()}>
                  确认删除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}
