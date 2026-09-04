import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * L2 内置插件：前端 feature registry。
 *
 * - 启动拉 GET /api/features 建状态；关掉的功能：路由不挂、侧栏项消失、按钮隐藏
 * - 设置页拨开关 → 乐观更新本地 registry → UI 立即重算
 * - SSE feature.changed 事件同步多标签页/多设备（其他端改了开关，本端立即跟随）
 *
 * 服务端 gating 是权威：前端隐藏只是体验层，关掉的 API 一律 404。
 */

export interface FeatureState {
  id: string
  name: string
  desc: string
  enabled: boolean
  canToggle: boolean
}

interface FeaturesCtxValue {
  /** null = 尚未加载完成（拉取 /api/features 中） */
  features: FeatureState[] | null
  /** 指定 feature 是否启用；未加载完成时默认 true（避免闪隐，见下） */
  isEnabled: (id: string) => boolean
  /** 设置页开关回调：乐观更新 + PUT 服务端（失败回滚） */
  toggle: (id: string, enabled: boolean) => Promise<void>
  /** 重新拉取清单（SSE feature.changed 触发） */
  refresh: () => Promise<void>
}

const FeaturesCtx = createContext<FeaturesCtxValue | null>(null)

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureState[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/features', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { data: FeatureState[] }
      setFeatures(body.data)
    } catch {
      // 拉取失败（老服务端无此端点/网络问题）：保持 null，isEnabled 按 true 兜底
      setFeatures(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // SSE：其他标签页/设备切换开关时同步本地状态
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('vault', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as { type: string; path?: string }
        if (ev.type === 'feature.changed') void refresh()
      } catch {
        // 忽略解析失败
      }
    })
    return () => es.close()
  }, [refresh])

  // 未加载完成时默认放行：feature 体系是新加的，老会话/拉取失败不该把
  // 侧栏/路由闪没；权威 gating 在服务端 404。
  const isEnabled = useCallback(
    (id: string) => (features ? (features.find((f) => f.id === id)?.enabled ?? true) : true),
    [features],
  )

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      // 乐观更新
      setFeatures((prev) =>
        prev ? prev.map((f) => (f.id === id ? { ...f, enabled } : f)) : prev,
      )
      try {
        const res = await fetch(`/api/features/${id}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { data: FeatureState[] }
        setFeatures(body.data)
      } catch {
        // 失败回滚（重新拉权威状态）
        void refresh()
        throw new Error('toggle failed')
      }
    },
    [refresh],
  )

  return (
    <FeaturesCtx.Provider value={{ features, isEnabled, toggle, refresh }}>
      {children}
    </FeaturesCtx.Provider>
  )
}

export function useFeatures(): FeaturesCtxValue {
  const ctx = useContext(FeaturesCtx)
  if (!ctx) throw new Error('useFeatures must be used within FeaturesProvider')
  return ctx
}

/**
 * 模块级便捷访问：路由表（App.tsx createBrowserRouter 顶层）等
 * 无法挂 Provider 内消费者的场景用。Provider 挂载后自动同步。
 */
let currentFeatures: FeatureState[] | null = null

export function setGlobalFeatures(list: FeatureState[] | null) {
  currentFeatures = list
}

export function featureEnabled(id: string): boolean {
  return currentFeatures ? (currentFeatures.find((f) => f.id === id)?.enabled ?? true) : true
}

// Provider 状态变化时同步模块级副本
export function useSyncGlobalFeatures() {
  const { features } = useFeatures()
  const ref = useRef(features)
  ref.current = features
  useEffect(() => {
    setGlobalFeatures(features)
  }, [features])
}
