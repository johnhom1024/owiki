import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '@/i18n/LangProvider'
import ReactMarkdown from 'react-markdown'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * 内置 AI 对话面板（右侧占位栏内容）。
 *
 * 协议（POST /api/chat/sessions/:sid/stream，SSE 响应）：
 *   start {runId}
 *   token {runId, text, partial}
 *   tool_call {runId, id, name, arguments}
 *   tool_result {runId, toolId, toolName, content}
 *   done {runId}
 *   error {error}
 * 危险工具确认：工具执行前服务端不推 confirm 事件，而是通过
 * pending 状态轮询——首版简化为：tool_call 出现 + 3s 内无 tool_result
 * 且面板顶部落下确认条（服务端 broker 挂起时 Resolve 端点可用）。
 * 实际实现：服务端在 mapEvents 外由 BeforeToolCallback 直接写 SSE
 * confirm 帧（见下 onConfirm 事件）。
 */

interface Msg {
  role: 'user' | 'assistant'
  text: string
  /** 流式进行中（后续 token 追加到本条） */
  streaming?: boolean
}

interface ToolActivity {
  id: string
  name: string
  args: string
  state: 'calling' | 'done' | 'denied'
  result?: string
}

interface PendingConfirm {
  runId: string
  tool: string
  args: string
}

export function ChatPanel() {
  const { t } = useLang()
  const [sessionId] = useState(() => {
    try {
      const saved = localStorage.getItem('owiki-chat-session')
      if (saved) return saved
    } catch {
      /* ignore */
    }
    const id = 's-' + Math.random().toString(36).slice(2, 10)
    try {
      localStorage.setItem('owiki-chat-session', id)
    } catch {
      /* ignore */
    }
    return id
  })
  const [messages, setMessages] = useState<Msg[]>([])
  const [tools, setTools] = useState<ToolActivity[]>([])
  const [streaming, setStreaming] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 历史回放
  useEffect(() => {
    fetch(`/api/chat/sessions/${sessionId}/events`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data: Array<{ name: string; data: any }> }) => {
        const msgs: Msg[] = []
        for (const ev of b.data ?? []) {
          if (ev.name === 'message' && ev.data) {
            msgs.push({ role: ev.data.role === 'user' ? 'user' : 'assistant', text: ev.data.text })
          }
        }
        if (msgs.length) setMessages(msgs)
      })
      .catch(() => {})
  }, [sessionId])

  // 自动滚底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, tools])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError(null)
    setMessages((m) => [...m, { role: 'user', text }])
    setStreaming(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: text }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(b.error || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          handleFrame(frame)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      // 流结束：把最后一条 streaming 消息定格
      setMessages((m) => {
        const last = m[m.length - 1]
        if (last?.streaming) return [...m.slice(0, -1), { ...last, streaming: false }]
        return m
      })
      setStreaming(false)
      abortRef.current = null
    }

    function handleFrame(frame: string) {
      // SSE 帧：event: <name>\ndata: <json>
      const evMatch = frame.match(/^event: (.+)$/m)
      const dataMatch = frame.match(/^data: (.+)$/m)
      if (!evMatch || !dataMatch) return
      const name = evMatch[1]
      let data: any = {}
      try {
        data = JSON.parse(dataMatch[1])
      } catch {
        return
      }
      switch (name) {
        case 'token':
          setMessages((m) => {
            const last = m[m.length - 1]
            if (last?.role === 'assistant' && last.streaming) {
              return [...m.slice(0, -1), { ...last, text: last.text + data.text }]
            }
            return [...m, { role: 'assistant', text: data.text, streaming: true }]
          })
          break
        case 'message':
          setMessages((m) => [...m, { role: data.role, text: data.text }])
          break
        case 'tool_call':
          setTools((ts) => [
            ...ts,
            { id: data.id, name: data.name, args: data.arguments, state: 'calling' },
          ])
          break
        case 'tool_result':
          setTools((ts) =>
            ts.map((x) =>
              x.id === data.toolId || x.name === data.toolName
                ? { ...x, state: 'done', result: data.content }
                : x,
            ),
          )
          break
        case 'confirm':
          setConfirm({ runId: data.runId, tool: data.tool, args: data.args })
          break
        case 'error':
          setError(data.error)
          break
      }
    }
  }, [input, streaming, sessionId])

  const answerConfirm = useCallback(
    async (approved: boolean) => {
      if (!confirm) return
      const runId = confirm.runId
      setConfirm(null)
      setTools((ts) =>
        ts.map((x) => (x.state === 'calling' ? { ...x, state: approved ? 'calling' : 'denied' } : x)),
      )
      await fetch(`/api/chat/runs/${runId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ approved }),
      }).catch(() => {})
    },
    [confirm],
  )

  const busy = streaming || !!confirm

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息列表 */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && !streaming && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Sparkles className="size-8 opacity-50" />
            <p className="text-sm">{t.chat.emptyHint}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {m.role === 'assistant' ? (
                <div className="markdown-body prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}

        {/* 工具活动（助理消息后、下一次 token 前） */}
        {tools.length > 0 && (
          <div className="space-y-1.5">
            {tools.map((tc) => (
              <details
                key={tc.id + tc.name}
                className="group rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs"
              >
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground">
                  {tc.state === 'calling' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : tc.state === 'denied' ? (
                    <X className="size-3.5 text-destructive" />
                  ) : (
                    <Check className="size-3.5 text-emerald-500" />
                  )}
                  <Wrench className="size-3" />
                  <span className="font-mono">{tc.name}</span>
                  <ChevronDown className="ml-auto size-3 transition-transform group-open:rotate-180" />
                </summary>
                <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {tc.result ?? tc.args}
                </pre>
              </details>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* 确认条 */}
      {confirm && (
        <div className="border-t border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.chat.confirmTitle}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {confirm.tool} {confirm.args}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void answerConfirm(false)}>
              {t.chat.confirmDeny}
            </Button>
            <Button size="sm" onClick={() => void answerConfirm(true)}>
              {t.chat.confirmAllow}
            </Button>
          </div>
        </div>
      )}

      {/* 输入区 */}
      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? t.chat.thinking : t.chat.placeholder}
            disabled={busy}
          />
          <Button type="submit" size="icon" disabled={!input.trim() || busy}>
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  )
}
