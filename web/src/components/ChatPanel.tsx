import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useLang } from '@/i18n/LangProvider'
import ReactMarkdown from 'react-markdown'
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  applyEvent,
  addUserItem,
  initialChatState,
  type ChatState,
  type TimelineItem,
} from '@/lib/agui'
import { feedSSE, flushSSE, newSSEParserState, parseAguiEvent } from '@/lib/sse'

/**
 * 内置 AI 对话面板（右侧占位栏内容）。AG-UI 协议。
 *
 * 状态模型：单一 TimelineItem[] 时间线（agui.ts 的 applyEvent 是唯一转移入口）。
 * - 工具卡片插在它发生的位置，后续文字新开 assistant 条目排在后面
 * - reasoning 折叠面板（REASONING_*）
 * - TOOL_CALL_RESULT 按 toolCallId 精确回填
 * - 危险工具确认走 CUSTOM tool_confirm / tool_confirm_result
 */

type Action =
  | { t: 'event'; ev: Record<string, any> }
  | { t: 'user'; text: string }
  | { t: 'replace'; state: ChatState }
  | { t: 'reset' }

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.t) {
    case 'event':
      return applyEvent(state, action.ev as any)
    case 'user':
      return addUserItem(state, action.text)
    case 'replace':
      return action.state
    case 'reset':
      return { ...initialChatState }
  }
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
  const [state, dispatch] = useReducer(reducer, initialChatState)
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const busy = state.running || !!state.confirm

  // 历史回放（AG-UI 事件数组 → 时间线）
  useEffect(() => {
    let cancelled = false
    fetch(`/api/chat/sessions/${sessionId}/events`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data: Array<Record<string, any>> }) => {
        if (cancelled) return
        let s = initialChatState
        for (const ev of b.data ?? []) s = applyEvent(s, ev as any)
        dispatch({ t: 'replace', state: s })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // 自动滚底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [state.items])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    dispatch({ t: 'user', text })
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
      const sse = newSSEParserState()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const json of feedSSE(sse, decoder.decode(value, { stream: true }))) {
          const ev = parseAguiEvent(json)
          if (ev) dispatch({ t: 'event', ev })
        }
      }
      for (const json of flushSSE(sse)) {
        const ev = parseAguiEvent(json)
        if (ev) dispatch({ t: 'event', ev })
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        dispatch({ t: 'event', ev: { type: 'RUN_ERROR', message: (e as Error).message } })
      }
    } finally {
      abortRef.current = null
    }
  }, [input, busy, sessionId])

  const answerConfirm = useCallback(
    async (approved: boolean) => {
      const runId = state.confirm?.runId
      dispatch({
        t: 'event',
        ev: { type: 'CUSTOM', name: 'tool_confirm_result', value: { approved } },
      })
      if (!runId) return
      await fetch(`/api/chat/runs/${runId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ approved }),
      }).catch(() => {})
    },
    [state.confirm],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息时间线 */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {state.items.length === 0 && !state.running && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Sparkles className="size-8 opacity-50" />
            <p className="text-sm">{t.chat.emptyHint}</p>
          </div>
        )}
        {state.items.map((item) => (
          <TimelineRow key={item.key} item={item} />
        ))}

        {state.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {state.error}
          </div>
        )}
      </div>

      {/* 确认条 */}
      {state.confirm && (
        <div className="border-t border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.chat.confirmTitle}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {state.confirm.tool} {state.confirm.args}
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
            {state.running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** 时间线单行渲染：按 kind 分派。 */
function TimelineRow({ item }: { item: TimelineItem }) {
  const { t } = useLang()
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed">
            {item.text}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="flex justify-start">
          <div className="bg-muted text-foreground max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed">
            {item.text ? (
              <div className="markdown-body prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{item.text}</ReactMarkdown>
              </div>
            ) : (
              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" />
              </span>
            )}
          </div>
        </div>
      )
    case 'reasoning':
      return (
        <details open={item.open} className="group rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground">
            <Brain className="size-3.5" />
            <span>{item.text ? t.chat.thinkingLabel : t.chat.thinkingPending}</span>
            <ChevronDown className="ml-auto size-3 transition-transform group-open:rotate-180" />
          </summary>
          <pre className="text-muted-foreground mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap font-sans leading-relaxed">
            {item.text}
          </pre>
        </details>
      )
    case 'tool':
      return (
        <details className="group rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground">
            {item.status === 'calling' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : item.status === 'denied' ? (
              <X className="text-destructive size-3.5" />
            ) : (
              <Check className="size-3.5 text-emerald-500" />
            )}
            <Wrench className="size-3" />
            <span className="font-mono">{item.name}</span>
            <ChevronDown className="ml-auto size-3 transition-transform group-open:rotate-180" />
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {item.result ?? item.args}
          </pre>
        </details>
      )
  }
}
