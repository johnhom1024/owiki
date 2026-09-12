import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useLang } from '@/i18n/LangProvider'
import ReactMarkdown from 'react-markdown'
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  Square,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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

export function ChatPanel({ sessionId }: { sessionId: string }) {
  const { t } = useLang()
  const [state, dispatch] = useReducer(reducer, initialChatState)
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  // textarea 自动增高（DeepSeek 式）：内容变化即重算，上限 40vh
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + 'px'
  }, [input])

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
    if (!text || state.running || !!state.confirm) return
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
  }, [input, state.running, state.confirm, sessionId])

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

      {/* 输入区（DeepSeek 式：圆角容器 + 框内右下角按钮） */}
      <div className="border-t p-3">
        <div
          className={cn(
            'focus-within:border-primary/60 bg-muted/50 flex flex-col gap-2 rounded-xl border px-3 py-2.5',
            'transition-colors',
          )}
        >
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={() => (composingRef.current = false)}
            onKeyDown={(e) => {
              // Enter 发送 / Shift+Enter 换行；输入法组合中不发送
              if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={state.running ? t.chat.thinking : t.chat.placeholder}
            disabled={!!state.confirm}
            className={cn(
              'placeholder:text-muted-foreground max-h-[40vh] min-h-[1.5rem] w-full resize-none',
              'border-0 bg-transparent text-sm leading-relaxed outline-none',
              'focus-visible:ring-0 focus-visible:ring-offset-0',
              !!state.confirm && 'opacity-60',
            )}
          />
          <div className="flex items-center justify-end">
            {state.running ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                title={t.chat.stop}
                className="bg-muted text-muted-foreground hover:bg-muted/80 flex size-8 items-center justify-center rounded-full transition-colors"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim()}
                title={t.chat.send}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full transition-all',
                  input.trim()
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50',
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-1.5 px-1 text-[10px]">
          {t.chat.inputHint}
        </p>
      </div>
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
