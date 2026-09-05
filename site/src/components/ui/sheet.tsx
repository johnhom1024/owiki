import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetTitle = DialogPrimitive.Title
export const SheetDescription = DialogPrimitive.Description

export function SheetContent({ children, className, closeLabel = 'Close', ...props }: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
      <DialogPrimitive.Content className={cn('fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col border-r border-line bg-page p-6 shadow-2xl outline-none', className)} {...props}>
        {children}
        <DialogPrimitive.Close aria-label={closeLabel} className="absolute top-5 right-4 rounded-md p-2 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"><X className="size-4" /></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
