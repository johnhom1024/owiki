import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '@/i18n/LangProvider'
import { Check, History, Loader2, MessageSquare, SquarePen, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 会话历史侧板（从对话栏顶栏滑出）：列出 / 切换 / 删除会话。
 * 不用 Dialog——面板本来就是 docked 侧栏，overlay 弹层在窄栏里体验差；
 * 这里做成栏内滑入层，backdrop 只盖对话区域。
 */

export interface SessionMeta {
  id: string
  title: string
  updatedAt: string
}

function fmtTime(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const now = new Date()
  const sameDay = t.toDateString() === now.toDateString()
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  if (sameDay) return hm
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (t.toDateString() === yest.toDateString()) return `昨天 ${hm}`
  return `${t.getMonth() + 1}/${t.getDate()}`
}

export function SessionHistoryPanel({
  open,
  currentId,
  onSwitch,
  onNew,
  onDelete,
  onClose,
}: {
  open: boolean
  currentId: string
  onSwitch: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { t } = useLang()
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const reqSeq = useRef(0)

  const load = useCallback(() => {
    const seq = ++reqSeq.current
    fetch('/api/chat/sessions', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data: SessionMeta[] }) => {
        if (seq === reqSeq.current) setSessions(b.data ?? [])
      })
      .catch(() => {
        if (seq === reqSeq.current) setSessions([])
      })
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const remove = useCallback(
    async (id: string) => {
      setDeleting(id)
      try {
        await fetch(`/api/chat/sessions/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        })
        onDelete(id)
        load()
      } finally {
        setDeleting(null)
      }
    },
    [load, onDelete],
  )

  return (
    <div
      className={cn(
        'bg-sidebar absolute inset-0 z-20 flex min-h-0 flex-col transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      aria-hidden={!open}
    >
      {/* 顶栏 */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
        <History className="text-muted-foreground ml-1 size-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{t.chat.historyTitle}</p>
        <button
          type="button"
          onClick={onNew}
          title={t.chat.newChat}
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-7 items-center justify-center rounded-md"
        >
          <SquarePen className="size-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t.chat.close}
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-7 items-center justify-center rounded-md"
        >
          <Check className="size-4" />
        </button>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {sessions === null && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
          </div>
        )}
        {sessions !== null && sessions.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-xs">
            <MessageSquare className="size-6 opacity-40" />
            {t.chat.historyEmpty}
          </div>
        )}
        {sessions?.map((s) => {
          const active = s.id === currentId
          return (
            <div
              key={s.id}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs',
                active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60',
              )}
              onClick={() => !active && onSwitch(s.id)}
            >
              {active ? (
                <Check className="text-primary size-3.5 shrink-0" />
              ) : (
                <MessageSquare className="text-muted-foreground size-3.5 shrink-0 opacity-60" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.title || t.chat.untitledChat}</p>
                <p className="text-muted-foreground mt-0.5">{fmtTime(s.updatedAt)}</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (deleting === null) void remove(s.id)
                }}
                title={t.chat.deleteChat}
                className={cn(
                  'text-muted-foreground hover:text-destructive flex size-6 shrink-0 items-center justify-center rounded',
                  'opacity-0 transition-opacity group-hover:opacity-100',
                  deleting === s.id && 'opacity-100',
                )}
              >
                {deleting === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
