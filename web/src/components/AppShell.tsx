import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  FileText,
  FolderPlus,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Settings,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { api, type FileMeta, type VaultMeta } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { CreateVaultDialog } from '@/components/CreateVaultDialog.tsx'
import { FileTree } from '@/components/FileTree.tsx'
import { Logo } from '@/components/Logo.tsx'
import { SettingsDialog } from '@/components/SettingsDialog.tsx'

/** 移动端顶栏的设置齿轮：自持弹窗状态 */
function SettingsDrawerButton() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t.nav.settings}
        className="text-muted-foreground hover:bg-sidebar-accent rounded-md p-2"
      >
        <Settings className="size-5" />
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 侧栏导航行的基础样式 */
const navRow =
  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]'

/* ============================================================
   侧栏主体：品牌区 + 总览 + vault 列表（vault 内含文件树）+ 底部导航
   ============================================================ */

function SidebarBody({
  vaults,
  onRefresh,
  treeRefreshTick,
  syncProgress,
  onLogout,
  onNavigated,
  showClose,
  onClose,
}: {
  vaults: VaultMeta[]
  onRefresh: () => Promise<void>
  /** vaultId -> 刷新次数：SSE 收到 vault.sync_done 时递增，变化即重新拉文件列表 */
  treeRefreshTick?: Record<number, number>
  /** vaultId -> {total, done}：服务端 SSE 推送的同步进度 */
  syncProgress?: Record<number, { total: number; done: number }>
  onLogout?: () => void
  onNavigated?: () => void
  showClose?: boolean
  onClose?: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLang()

  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const vaultId = useMemo(() => {
    const m = location.pathname.match(/^\/vaults\/(\d+)/)
    return m ? Number(m[1]) : undefined
  }, [location.pathname])
  const inVault = vaultId !== undefined

  // ---- 当前 vault 的文件树数据 ----
  const [files, setFiles] = useState<FileMeta[]>([])
  const tick = vaultId !== undefined ? treeRefreshTick?.[vaultId] : undefined
  useEffect(() => {
    if (!inVault) return
    let cancelled = false
    api
      .listVaultFiles(vaultId!)
      .then((r) => {
        if (!cancelled) setFiles(r.data)
      })
      .catch(() => {
        if (!cancelled) setFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [inVault, vaultId, tick])

  // 当前打开的文件路径（用于树里高亮）
  const currentPath = useMemo(() => {
    const m = location.pathname.match(/^\/vaults\/\d+\/files\/(\d+)/)
    if (!m || !files.length) return undefined
    return files.find((f) => f.id === Number(m[1]))?.path
  }, [location.pathname, files])

  // 正在同步的 vault（含名称，展示在侧栏进度条里）
  const syncingVault = useMemo(() => {
    const entries = Object.entries(syncProgress ?? {})
    for (const [vid, p] of entries) {
      if (p.total > 0 && p.done < p.total) {
        const v = vaults.find((x) => x.id === Number(vid))
        return { id: Number(vid), name: v?.name ?? `Vault ${vid}`, ...p }
      }
    }
    return null
  }, [syncProgress, vaults])

  const go = (to: string) => {
    navigate(to)
    onNavigated?.()
  }

  return (
    <div className="flex h-full flex-col">
      {/* 品牌区：Logo + 主题切换（移动端再带收起按钮） */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2.5">
        <button
          onClick={() => go('/')}
          className="hover:bg-sidebar-accent flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1"
          title={t.nav.overview}
        >
          <Logo className="size-6 shrink-0" />
          <span className="truncate text-sm font-semibold tracking-tight">{t.nav.appName}</span>
        </button>
        {showClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:bg-sidebar-accent rounded-md p-1.5"
            title={t.common.back}
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* 总览 */}
        <button
          onClick={() => go('/')}
          className={cn(navRow, location.pathname === '/' && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium')}
        >
          <Home className="size-4 shrink-0 opacity-70" />
          <span>{t.nav.overview}</span>
        </button>

        {/* Vault 列表 */}
        <div className="mt-4 mb-1 flex items-center justify-between px-2">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            {t.nav.vaults}
          </span>
          <button
            onClick={() => setCreating(true)}
            title={t.nav.newVault}
            className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded p-1"
          >
            <FolderPlus className="size-3.5" />
          </button>
        </div>
        <div className="space-y-0.5">
          {vaults.map((v) => (
            <div key={v.id} className="group relative">
              <button
                onClick={() => go(`/vaults/${v.id}`)}
                title={v.note || v.name}
                className={cn(
                  navRow,
                  v.id === vaultId && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
                )}
              >
                <BookOpen className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {v.clients > 0 && (
                  <span className="bg-primary size-2 shrink-0 rounded-full" title={fill(t.nav.clientsOnline, { n: v.clients })} />
                )}
              </button>
              {/* 悬停浮现的设置入口 */}
              <button
                onClick={() => go(`/vaults/${v.id}/settings`)}
                title={t.nav.vaultSettings}
                className="text-muted-foreground hover:text-foreground bg-sidebar-accent absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded p-1 group-hover:block"
              >
                <Settings2 className="size-3.5" />
              </button>
            </div>
          ))}
          {vaults.length === 0 && (
            <p className="text-muted-foreground px-2 py-2 text-xs">{t.nav.noVaultsYet}</p>
          )}
        </div>

        {/* 当前 vault 的文件树 */}
        {inVault && (
          <div className="mt-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider uppercase">
              <FileText className="size-3" />
              {t.nav.files}
            </div>
            {files.length > 0 ? (
              <FileTree files={files} currentPath={currentPath} onOpenFile={(f) => go(`/vaults/${vaultId}/files/${f.id}`)} />
            ) : (
              <p className="text-muted-foreground px-2 py-2 text-xs">{t.nav.noFilesYet}</p>
            )}
          </div>
        )}
      </nav>

      {/* 同步进度条：任意 vault 正在同步时展示 */}
      {syncingVault && (
        <button
          onClick={() => go(`/vaults/${syncingVault.id}`)}
          className="hover:bg-sidebar-accent mx-2 mb-2 shrink-0 rounded-md border px-2.5 py-2 text-left"
          title={fill(t.nav.syncingVault, { name: syncingVault.name })}
        >
          <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full" />
              <span className="truncate">
                {vaults.length > 1
                  ? fill(t.nav.syncingVault, { name: syncingVault.name })
                  : t.nav.syncing}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {syncingVault.done}/{syncingVault.total}
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-200"
              style={{
                width: `${Math.min(100, Math.floor((syncingVault.done / syncingVault.total) * 100))}%`,
              }}
            />
          </div>
        </button>
      )}

      {/* 底部导航 */}
      <div className="shrink-0 border-t px-2 py-2">
        {[
          { to: '/apikeys', icon: KeyRound, label: t.nav.apiKeys, active: location.pathname === '/apikeys' },
          { to: '/security', icon: ShieldCheck, label: t.nav.security, active: location.pathname === '/security' },
        ].map(({ to, icon: Icon, label, active }) => (
          <button
            key={to}
            onClick={() => go(to)}
            className={cn(navRow, active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium')}
          >
            <Icon className="size-4 shrink-0 opacity-70" />
            <span>{label}</span>
          </button>
        ))}
        <div className="mt-1 flex items-center justify-between">
          {onLogout && (
            <button
              onClick={onLogout}
              className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
            >
              <LogOut className="size-4 shrink-0" />
              <span>{t.nav.logout}</span>
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title={t.nav.settings}
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-8 items-center justify-center rounded-md"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>

      <CreateVaultDialog open={creating} onOpenChange={setCreating} onCreated={onRefresh} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

/* ============================================================
   状态栏：右下角的全局信息（Obsidian 式）
   ============================================================ */

function StatusBar({
  vaults,
  syncProgress,
}: {
  vaults: VaultMeta[]
  syncProgress?: Record<number, { total: number; done: number }>
}) {
  const { t } = useLang()
  const syncing = Object.entries(syncProgress ?? {}).find(([vid, p]) => {
    void vid
    return p.total > 0 && p.done < p.total
  })
  const onlineClients = vaults.reduce((sum, v) => sum + v.clients, 0)

  return (
    <div className="text-muted-foreground pointer-events-none absolute right-0 bottom-0 z-10 flex items-center gap-3 px-3 py-1 text-[11px] select-none">
      {syncing && (
        <span className="flex items-center gap-1.5">
          <span className="bg-primary inline-block size-1.5 animate-pulse rounded-full" />
          {t.nav.syncing} {syncing[1].done}/{syncing[1].total}
        </span>
      )}
      <span>{onlineClients > 0 ? fill(t.nav.onlineDevices, { n: onlineClients }) : t.nav.notConnected}</span>
      <span>{fill(t.nav.vaultCount, { n: vaults.length })}</span>
    </div>
  )
}

/* ============================================================
   AppShell：单侧栏 + 内容区（桌面常驻 / 移动抽屉复用同一主体）
   ============================================================ */

export function AppShell({
  vaults,
  onRefresh,
  treeRefreshTick,
  syncProgress,
  onLogout,
  children,
}: {
  vaults: VaultMeta[]
  onRefresh: () => Promise<void>
  treeRefreshTick?: Record<number, number>
  syncProgress?: Record<number, { total: number; done: number }>
  onLogout?: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { t } = useLang()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ---- 常驻侧栏（桌面端） ---- */}
      <aside className="bg-sidebar text-sidebar-foreground hidden w-[260px] shrink-0 border-r md:block">
        <SidebarBody
          vaults={vaults}
          onRefresh={onRefresh}
          treeRefreshTick={treeRefreshTick}
          syncProgress={syncProgress}
          onLogout={onLogout}
        />
      </aside>

      {/* ---- 内容区 + 状态栏 ---- */}
      <div className="relative min-w-0 flex-1">
        {/* 移动端顶栏 */}
        <div className="bg-sidebar fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b px-2 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-muted-foreground hover:bg-sidebar-accent rounded-md p-2"
            title={t.nav.appName}
          >
            <Menu className="size-5" />
          </button>
          <button className="flex items-center gap-2" onClick={() => navigate('/')}>
            <Logo className="size-6" />
            <span className="text-sm font-semibold">{t.nav.appName}</span>
          </button>
          <div className="flex-1" />
          <SettingsDrawerButton />
        </div>
        {/* 移动端抽屉 */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
            <aside className="bg-sidebar text-sidebar-foreground absolute inset-y-0 left-0 flex w-[280px] flex-col border-r shadow-xl">
              <SidebarBody
                vaults={vaults}
                onRefresh={onRefresh}
                treeRefreshTick={treeRefreshTick}
                syncProgress={syncProgress}
                onLogout={() => {
                  setDrawerOpen(false)
                  onLogout?.()
                }}
                onNavigated={() => setDrawerOpen(false)}
                showClose
                onClose={() => setDrawerOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="flex h-full min-h-0 flex-col overflow-hidden pt-12 md:pt-0">
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </main>
        <StatusBar vaults={vaults} syncProgress={syncProgress} />
      </div>
    </div>
  )
}
