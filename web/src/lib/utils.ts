import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 复制文本到剪贴板，跨安全上下文兼容。
 *
 * 三层降级：
 *   1. navigator.clipboard（仅 https / localhost / file:// 可用）
 *   2. document.execCommand('copy') + 隐藏 textarea（HTTP 内网等非安全上下文）
 *   3. 回退：把文本写入临时 <textarea> 并选中，由用户手动 Cmd/Ctrl+C
 *
 * 返回是否真正写入系统剪贴板（false 表示处于第 3 层降级状态）。
 */
export async function copyText(text: string): Promise<boolean> {
  // 第 1 层：现代 Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒或抛错，继续走降级
    }
  }

  // 第 2 层：execCommand 兼容老路径
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea')
    ta.value = text
    // 放到屏幕外但保持可选中
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.padding = '0'
    ta.style.border = 'none'
    ta.style.outline = 'none'
    ta.style.boxShadow = 'none'
    ta.style.background = 'transparent'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    const prevActive = document.activeElement as HTMLElement | null
    const prevSelection = document.getSelection()
    const prevRange =
      prevSelection && prevSelection.rangeCount > 0 ? prevSelection.getRangeAt(0) : null
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    // 恢复原选区
    ta.remove()
    prevActive?.focus?.({ preventScroll: true })
    if (prevRange && prevSelection) {
      prevSelection.removeAllRanges()
      prevSelection.addRange(prevRange)
    }
    if (ok) return true
    // 第 2 层失败，进入第 3 层：让用户手动复制
  }

  // 第 3 层：把文本塞进一个可见/可编辑的 textarea，提示用户按 Cmd/Ctrl+C
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '16px'
    ta.style.left = '16px'
    ta.style.width = '80vw'
    ta.style.maxWidth = '480px'
    ta.style.height = 'auto'
    ta.style.padding = '8px'
    ta.style.border = '1px solid #888'
    ta.style.borderRadius = '6px'
    ta.style.background = '#fff'
    ta.style.color = '#111'
    ta.style.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
    ta.style.zIndex = '2147483647'
    document.body.appendChild(ta)
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
  }

  return false
}
