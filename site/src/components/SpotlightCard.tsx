import { useRef, type MouseEvent, type ReactNode } from 'react'
import { cn } from '../lib/utils'

/**
 * 鼠标跟随边框高光卡片：mousemove 时把坐标写入 CSS 变量，
 * 由 index.css 的 .spotlight 伪元素渲染 1px 高光边框环 + 内部微光。
 */
export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  return (
    <div ref={ref} onMouseMove={onMouseMove} className={cn('spotlight', className)}>
      {children}
    </div>
  )
}
