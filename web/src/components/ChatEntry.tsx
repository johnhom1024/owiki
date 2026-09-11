import { useEffect, useState } from 'react'
import { Bot, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useLang } from '@/i18n/LangProvider'
import { useFeatures } from '@/lib/features'
import { useAI } from '@/lib/ai'
import { ChatPanel } from '@/components/ChatPanel'
import { cn } from '@/lib/utils'

const OPEN_KEY = 'owiki-chat-open'

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

/**
 * 右侧 AI 对话栏：桌面端占布局（可收成窄轨），笔记区被挤开而不是盖住。
 * 移动端空间不够，改为全高侧滑。两级门禁：feature "chat" + AI ready。
 */
export function ChatEntry() {
  const { t } = useLang()
  const { isEnabled } = useFeatures()
  const { showEntry } = useAI()
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open])

  if (!isEnabled('chat') || !showEntry) return null

  if (!desktop) {
    return <MobileChat open={open} onOpenChange={setOpen} />
  }

  return (
    <aside
      className={cn(
        'bg-sidebar text-sidebar-foreground flex h-full shrink-0 flex-col border-l',
        'transition-[width] duration-200 ease-out',
        open ? 'w-[min(24rem,40vw)]' : 'w-11',
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
        <Bot className="size-4 shrink-0 text-primary" />
        {open && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-none">{t.chat.panelTitle}</p>
            <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{t.chat.panelDesc}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={open ? t.chat.collapse : t.chat.expand}
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ml-auto flex size-7 items-center justify-center rounded-md"
        >
          {open ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>
      <div className={cn('min-h-0 flex-1', open ? 'flex flex-col' : 'hidden')}>
        <ChatPanel />
      </div>
    </aside>
  )
}

function MobileChat({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLang()
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          title={t.chat.entry}
          className={cn(
            'fixed right-4 bottom-14 z-40 flex size-11 items-center justify-center rounded-full',
            'bg-primary text-primary-foreground shadow-lg',
          )}
          aria-label={t.chat.entry}
        >
          <Bot className="size-5" />
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label={t.chat.collapse}
            onClick={() => onOpenChange(false)}
          />
          <aside className="bg-background absolute inset-y-0 right-0 flex w-[min(100%,24rem)] flex-col shadow-xl">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              <Bot className="size-4 text-primary" />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">{t.chat.panelTitle}</p>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:bg-muted rounded-md p-1.5"
              >
                <ChevronsRight className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
