import { useState } from 'react'
import { Bot } from 'lucide-react'
import { useLang } from '@/i18n/LangProvider'
import { useFeatures } from '@/lib/features'
import { useAI } from '@/lib/ai'
import { ChatPanel } from '@/components/ChatPanel'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * 右侧 AI 对话入口（悬浮触发器 + Sheet 面板）。
 * 两级门禁：feature "chat" 开（isEnabled）+ AI 配置 ready。
 */
export function ChatEntry() {
  const { t } = useLang()
  const { isEnabled } = useFeatures()
  const { showEntry } = useAI()
  const [open, setOpen] = useState(false)

  if (!isEnabled('chat') || !showEntry) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t.chat.entry}
        className={cn(
          'fixed right-5 bottom-14 z-40 flex size-11 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105',
        )}
        aria-label={t.chat.entry}
      >
        <Bot className="size-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Bot className="size-4" />
              {t.chat.panelTitle}
            </SheetTitle>
            <SheetDescription className="text-xs">{t.chat.panelDesc}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <ChatPanel />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
