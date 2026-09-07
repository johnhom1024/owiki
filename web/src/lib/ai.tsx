import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * AI 对话就绪状态：feature "chat" 开 + 服务端配置 ready（三项齐全且测通）。
 * 入口显隐 = isEnabled('chat') && aiReady。SSE feature.changed 已由
 * FeaturesProvider 处理；这里再监听 settings 变化（PUT 后主动失效）。
 */

export interface AIStatus {
  enabled: boolean
  ready: boolean
  baseUrl: string
  model: string
  apiKeySet: boolean
  lastTestOk: boolean
  lastTestAt: string
  lastTestErr: string
}

interface AICtx {
  status: AIStatus | null
  refresh: () => Promise<void>
  /** 入口显隐 */
  showEntry: boolean
}

const Ctx = createContext<AICtx | null>(null)

export function AIProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AIStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/settings', { credentials: 'same-origin' })
      if (!res.ok) {
        setStatus(null)
        return
      }
      setStatus((await res.json()) as AIStatus)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return <Ctx.Provider value={{ status, refresh, showEntry: !!status?.ready }}>{children}</Ctx.Provider>
}

export function useAI() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAI must be used within AIProvider')
  return v
}
