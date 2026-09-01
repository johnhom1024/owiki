import { type ReactNode } from 'react'
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ClipboardList,
  Flame,
  HelpCircle,
  Info,
  ListOrdered,
  Pencil,
  Quote,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Obsidian callout 渲染支持。
 *
 * obsidianMarkdown 预处理已把 "> [!type] 标题" 行替换为隐藏标记 span，
 * 这里在 blockquote 组件里扫描该标记，套用对应的彩色外观与标题栏；
 * 正文子节点原样透传，markdown 格式不受影响。
 */

/** 极简 hast 节点描述（react-markdown 的 node prop） */
interface HastNode {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

interface CalloutMeta {
  icon: LucideIcon
  /** 无显式标题时展示的默认标题（同 Obsidian 大写类型名） */
  label: string
}

const CALLOUTS: Record<string, CalloutMeta> = {
  note: { icon: Pencil, label: 'Note' },
  abstract: { icon: ClipboardList, label: 'Abstract' },
  summary: { icon: ClipboardList, label: 'Summary' },
  tldr: { icon: ClipboardList, label: 'TL;DR' },
  info: { icon: Info, label: 'Info' },
  todo: { icon: CheckCircle2, label: 'Todo' },
  tip: { icon: Flame, label: 'Tip' },
  hint: { icon: Flame, label: 'Hint' },
  important: { icon: Flame, label: 'Important' },
  success: { icon: CheckCircle2, label: 'Success' },
  check: { icon: CheckCircle2, label: 'Check' },
  done: { icon: CheckCircle2, label: 'Done' },
  question: { icon: HelpCircle, label: 'Question' },
  help: { icon: HelpCircle, label: 'Help' },
  faq: { icon: HelpCircle, label: 'FAQ' },
  warning: { icon: AlertTriangle, label: 'Warning' },
  caution: { icon: AlertTriangle, label: 'Caution' },
  attention: { icon: AlertTriangle, label: 'Attention' },
  failure: { icon: XCircle, label: 'Failure' },
  fail: { icon: XCircle, label: 'Fail' },
  missing: { icon: XCircle, label: 'Missing' },
  danger: { icon: Zap, label: 'Danger' },
  error: { icon: Zap, label: 'Error' },
  bug: { icon: Bug, label: 'Bug' },
  example: { icon: ListOrdered, label: 'Example' },
  quote: { icon: Quote, label: 'Quote' },
  cite: { icon: Quote, label: 'Cite' },
}

interface CalloutMarker {
  type: string
  title: string
}

/** 在 hast 树里找预处理注入的 callout 标记 span */
function findCalloutMarker(node: HastNode | undefined): CalloutMarker | null {
  if (!node?.children) return null
  for (const child of node.children) {
    if (child.tagName === 'span' && typeof child.properties?.dataCallout === 'string') {
      return {
        type: child.properties.dataCallout,
        title: typeof child.properties.dataTitle === 'string' ? child.properties.dataTitle : '',
      }
    }
    const nested = findCalloutMarker(child)
    if (nested) return nested
  }
  return null
}

/**
 * react-markdown components：目前只定制 blockquote（callout）。
 * 用法：<Markdown components={markdownComponents}>...</Markdown>
 */
export const markdownComponents = {
  blockquote: ({ node, children }: { node?: HastNode; children?: ReactNode }) => {
    const marker = findCalloutMarker(node)
    if (!marker) return <blockquote>{children}</blockquote>

    const meta = CALLOUTS[marker.type] ?? CALLOUTS.note
    const Icon = meta.icon
    const title = marker.title || meta.label

    return (
      <blockquote className="callout" data-callout={marker.type}>
        <div className="callout-title">
          <Icon className="size-4 shrink-0" />
          <span>{title}</span>
        </div>
        {children}
      </blockquote>
    )
  },
}
