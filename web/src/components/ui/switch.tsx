import type * as React from 'react'

/**
 * 简易开关（shadcn/ui Switch 的无依赖实现：原生 checkbox + peer 样式）。
 * 关键：label 必须有显式宽高——内部 input 是 sr-only（1x1 视觉隐藏），
 * 视觉元素都用 absolute 定位，必须靠 label 的尺寸才能正确定位。
 */
function Switch({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>): React.JSX.Element {
  return (
    <label
      className={
        'relative inline-block h-5 w-9 shrink-0 cursor-pointer rounded-full ' +
        (className ?? '')
      }
    >
      <input type="checkbox" className="peer sr-only" {...props} />
      {/* 轨道（背景）：绝对铺满 label */}
      <span
        aria-hidden
        className="bg-input pointer-events-none absolute inset-0 rounded-full shadow-xs transition-colors peer-checked:bg-primary peer-focus-visible:ring-ring peer-focus-visible:ring-2"
      />
      {/* 滑块：absolute 定位在轨道内，peer-checked 时平移 */}
      <span
        aria-hidden
        className="bg-background pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow-sm transition-transform peer-checked:translate-x-4"
      />
    </label>
  )
}

export { Switch }
