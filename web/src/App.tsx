import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, UnauthorizedError, type VaultMeta } from '@/lib/api.ts'
import { AppShell } from '@/components/AppShell.tsx'
import { HomePage } from '@/pages/HomePage.tsx'
import { VaultPage } from '@/pages/VaultPage.tsx'
import { VaultSettingsPage } from '@/pages/VaultSettingsPage.tsx'
import { FileViewPage } from '@/pages/FileViewPage.tsx'
import { ApiKeysPage } from '@/pages/ApiKeysPage.tsx'
import { SecurityPage } from '@/pages/SecurityPage.tsx'
import { LoginPage } from '@/pages/LoginPage.tsx'
import { SharedFilePage } from '@/pages/SharedFilePage.tsx'
import { useVaultEvents } from '@/hooks/useVaultEvents.ts'

/** 侧边栏需要的 vault 列表，全局共享一份（创建/删除后刷新） */
export function useVaults(authed: boolean) {
  const [vaults, setVaults] = useState<VaultMeta[] | null>(null)
  const refresh = useCallback(async () => {
    if (!authed) {
      setVaults(null)
      return
    }
    try {
      const res = await api.listVaults()
      setVaults(res.data)
    } catch {
      setVaults([])
    }
  }, [authed])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { vaults, setVaults, refreshVaults: refresh }
}

/** authed: null=探测中 false=未登录 true=已登录 */
export function App() {
  const location = useLocation()
  // 公开分享页：不进管理外壳、不探测登录（访客也能看）
  if (location.pathname.startsWith('/share/')) {
    return <SharedFilePage />
  }
  return <AdminApp />
}

/** 管理端（需登录）：原有的探测 + 外壳 + 路由 */
function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const { vaults, setVaults, refreshVaults } = useVaults(authed === true)

  // 启动时探测登录状态：listVaults 401 → 登录页；其他错误也按未登录处理（保守）
  useEffect(() => {
    let cancelled = false
    api
      .listVaults()
      .then(() => {
        if (!cancelled) setAuthed(true)
      })
      .catch((err) => {
        if (!cancelled) setAuthed(!(err instanceof UnauthorizedError) ? true : false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 已登录后任意请求收到 401（session 过期）→ 回登录页
  useEffect(() => {
    if (authed !== true) return
    const onUnauthorized = () => setAuthed(false)
    window.addEventListener('owiki-unauthorized', onUnauthorized)
    return () => window.removeEventListener('owiki-unauthorized', onUnauthorized)
  }, [authed])

  // refreshTick：SSE 收到事件时递增，settings page 依赖它自动重查
  const [refreshTick, setRefreshTick] = useState(0)
  // 同步进度（vaultId -> {total, done}）：服务端 SSE 推送，供文件列表页显示进度条
  const [syncProgress, setSyncProgress] = useState<Record<number, { total: number; done: number }>>({})
  // 文件树刷新 tick（vaultId -> 次数）：收到 vault.sync_done 时递增，
  // 处于该 vault 页面的侧边栏据此重新拉取文件列表
  const [treeRefreshTicks, setTreeRefreshTicks] = useState<Record<number, number>>({})
  // 同步日志刷新 tick（vaultId -> 次数）：收到 vault.log 时递增，
  // 设置页的「同步日志」卡片据此 debounce 刷新
  const [logRefreshTicks, setLogRefreshTicks] = useState<Record<number, number>>({})
  // 订阅服务端 SSE：vault 授权/取消授权/解绑等事件触发列表+设置页自动重查
  useVaultEvents(
    vaults,
    setVaults,
    () => {
      void refreshVaults()
      setRefreshTick((t) => t + 1)
    },
    (ev) => {
      setSyncProgress((prev) => ({ ...prev, [ev.vaultId]: { total: ev.total, done: ev.done } }))
    },
    (vaultId) => {
      setTreeRefreshTicks((prev) => ({ ...prev, [vaultId]: (prev[vaultId] ?? 0) + 1 }))
    },
    (vaultId) => {
      setLogRefreshTicks((prev) => ({ ...prev, [vaultId]: (prev[vaultId] ?? 0) + 1 }))
    },
    (ev) => {
      window.dispatchEvent(new CustomEvent('owiki-note-synced', { detail: ev }))
    },
  )

  if (authed === null) {
    // 探测登录状态中：白屏比闪一下登录页再跳回更平滑
    return <div className="min-h-screen bg-background" />
  }

  if (authed === false) {
    return <LoginPage onLoggedIn={() => setAuthed(true)} />
  }

  return (
    <AppShell
      vaults={vaults ?? []}
      onRefresh={refreshVaults}
      treeRefreshTick={treeRefreshTicks}
      syncProgress={syncProgress}
      onLogout={async () => {
        try {
          await api.logout()
        } catch {
          // 忽略登出失败
        }
        setAuthed(false)
      }}
    >      <Routes>
        <Route path="/" element={<HomePage vaults={vaults} onRefresh={refreshVaults} />} />
        <Route path="/apikeys" element={<ApiKeysPage vaults={vaults} />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/vaults/:vid" element={<VaultPage syncProgress={syncProgress} />} />
        <Route
          path="/vaults/:vid/settings"
          element={
            <VaultSettingsPage
              refreshTick={refreshTick}
              logRefreshTicks={logRefreshTicks}
              onRefresh={refreshVaults}
            />
          }
        />
        <Route path="/vaults/:vid/files/:id" element={<FileViewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
