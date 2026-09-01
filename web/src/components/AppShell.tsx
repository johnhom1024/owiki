import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  FileText,
  FolderPlus,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react'
import { api, type FileMeta, type VaultMeta } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'
import { FileTree } from '@/components/FileTree.tsx'
import { Logo } from '@/components/Logo.tsx'
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

/* ============================================================
   暗色主题：跟随系统，可手动切换并持久化
   ============================================================ */

type Theme = 'light' | 'dark'

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('owiki-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)
  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem('owiki-theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}

function ThemeButton({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
      className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-muted-foreground flex size-8 items-center justify-center rounded-md"
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

/* ============================================================
   Vault 切换器：侧栏顶部的下拉面板（含新建 vault）
   ============================================================ */

function VaultSwitcher({
  vaults,
  currentId,
  onNavigate,
  onRefresh,
}: {
  vaults: VaultMeta[]
  currentId?: number
  onNavigate: (to: string) => void
  onRefresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = vaults.find((v) => v.id === currentId)

  const create = async () => {
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.createVault({ name: name.trim(), note: note.trim() })
      setCreating(false)
      setName('')
      setNote('')
      setOpen(false)
      await onRefresh()
      onNavigate(`/vaults/${res.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative px-2 pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
          open && 'bg-sidebar-accent',
        )}
      >
        <BookOpen className="text-primary size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={current?.name}>
          {current?.name ?? '选择 vault'}
        </span>
        {current && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(`/vaults/${current.id}/settings`)
            }}
            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
            title="vault 设置"
          >
            <Settings2 className="size-3.5" />
          </span>
        )}
        <ChevronDown className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {/* 下拉面板 */}
      {open && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="bg-popover absolute inset-x-2 top-full z-40 mt-1 overflow-hidden rounded-lg border shadow-lg">
            <div className="max-h-64 overflow-y-auto p-1">
              {vaults.map((v) => (
                <button
                  key={v.id}
                  title={v.note || v.name}
                  onClick={() => {
                    setOpen(false)
                    onNavigate(`/vaults/${v.id}`)
                  }}
                  className={cn(
                    'hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    v.id === currentId && 'bg-sidebar-accent font-medium',
                  )}
                >
                  <BookOpen className="size-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{v.name}</span>
                    {v.note && (
                      <span className="text-muted-foreground block truncate text-xs font-normal">
                        {v.note}
                      </span>
                    )}
                  </span>
                  {v.clients > 0 && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" title={`${v.clients} 个连接在线`} />
                  )}
                </button>
              ))}
              {vaults.length === 0 && (
                <p className="text-muted-foreground px-2 py-3 text-center text-xs">还没有 vault</p>
              )}
            </div>
            <button
              onClick={() => {
                setOpen(false)
                setCreating(true)
              }}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm"
            >
              <FolderPlus className="size-4" />
              新建 vault
            </button>
          </div>
        </>
      )}

      {/* 创建对话框 */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 Vault</DialogTitle>
            <DialogDescription>每个 vault 是一个独立的同步库，拥有自己的同步令牌。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vault-name">名称</Label>
              <Input
                id="vault-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：个人笔记、工作库"
                onKeyDown={(e) => e.key === 'Enter' && void create()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vault-note">备注（可选）</Label>
              <Input
                id="vault-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="简单描述一下这个库"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ============================================================
   侧栏主体：切换器 + 文件树（vault 内）/ 提示 + 底部导航
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
      {/* 顶部：移动端关闭按钮 + vault 切换器 */}
      <div className="flex items-start gap-1 pr-2">
        <div className="min-w-0 flex-1">
          <VaultSwitcher vaults={vaults} currentId={vaultId} onNavigate={go} onRefresh={onRefresh} />
        </div>
        {showClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:bg-sidebar-accent mt-2 rounded-md p-1.5"
            title="收起"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* 中部：文件树 / 空状态提示 */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {inVault ? (
          <>
            <div className="text-muted-foreground flex items-center gap-1.5 px-2.5 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              <FileText className="size-3" />
              文件
            </div>
            {files.length > 0 ? (
              <FileTree files={files} currentPath={currentPath} onOpenFile={(f) => go(`/vaults/${vaultId}/files/${f.id}`)} />
            ) : (
              <p className="text-muted-foreground px-2.5 py-3 text-xs">还没有文件——去设置页连接 Obsidian 同步</p>
            )}
          </>
        ) : (
          <button
            onClick={() => go('/')}
            className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
          >
            <Home className="size-4 shrink-0 opacity-70" />
            <span>全部 vault</span>
          </button>
        )}
      </nav>

      {/* 同步进度条：任意 vault 正在同步时展示 */}
      {syncingVault && (
        <button
          onClick={() => go(`/vaults/${syncingVault.id}`)}
          className="hover:bg-sidebar-accent mx-2 mb-2 rounded-md border px-2.5 py-2 text-left"
          title={`正在同步 ${syncingVault.name}`}
        >
          <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full" />
              <span className="truncate">
                同步中{vaults.length > 1 ? ` · ${syncingVault.name}` : ''}
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
      <div className="border-t px-2 py-2">
        {[
          { to: '/apikeys', icon: KeyRound, label: 'API 密钥', active: location.pathname === '/apikeys' },
          { to: '/security', icon: ShieldCheck, label: '安全设置', active: location.pathname === '/security' },
        ].map(({ to, icon: Icon, label, active }) => (
          <button
            key={to}
            onClick={() => go(to)}
            className={cn(
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
            )}
          >
            <Icon className="size-4 shrink-0 opacity-70" />
            <span>{label}</span>
          </button>
        ))}
        {onLogout && (
          <button
            onClick={onLogout}
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]"
          >
            <LogOut className="size-4 shrink-0" />
            <span>登出</span>
          </button>
        )}
      </div>
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
          同步中 {syncing[1].done}/{syncing[1].total}
        </span>
      )}
      <span>{onlineClients > 0 ? `${onlineClients} 个设备在线` : '未连接'}</span>
      <span>{vaults.length} 个 vault</span>
    </div>
  )
}

/* ============================================================
   AppShell：Ribbon + 常驻侧栏 + 内容区（三段式稳定外壳）
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
  const { theme, toggle } = useTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ---- Ribbon：最左图标条（桌面端） ---- */}
      <div className="bg-sidebar hidden w-[44px] shrink-0 flex-col items-center border-r py-2.5 md:flex">
        <button onClick={() => navigate('/')} title="OWiki 总览" className="mb-2">
          <Logo className="size-6" />
        </button>
        <button
          onClick={() => navigate('/')}
          title="全部 vault"
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-8 items-center justify-center rounded-md"
        >
          <Home className="size-4" />
        </button>
        <div className="flex-1" />
        <ThemeButton theme={theme} toggle={toggle} />
      </div>

      {/* ---- 常驻侧栏（桌面端） ---- */}
      <aside className="bg-sidebar text-sidebar-foreground hidden w-[272px] shrink-0 border-r md:block">
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
            title="打开侧栏"
          >
            <Menu className="size-5" />
          </button>
          <button className="flex items-center gap-2" onClick={() => navigate('/')}>
            <Logo className="size-6" />
            <span className="text-sm font-semibold">OWiki</span>
          </button>
          <div className="flex-1" />
          <ThemeButton theme={theme} toggle={toggle} />
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

        <main className="h-full overflow-y-auto pt-12 md:pt-0">
          {children}
        </main>
        <StatusBar vaults={vaults} syncProgress={syncProgress} />
      </div>
    </div>
  )
}
