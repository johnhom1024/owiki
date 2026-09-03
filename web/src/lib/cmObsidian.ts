/**
 * CodeMirror 6 的 Obsidian 扩展语法支持：
 *
 * 1. [[wikilink]] / ![[嵌入]]   → 装饰上色（链接紫、嵌入弱化）
 * 2. ==高亮==                    → 黄底
 * 3. #标签                       → 紫色药丸
 * 4. > [!callout] 标题行         → 整行按 callout 色着色
 * 5. 输入 [[ 时弹出 vault 文件名自动补全（数据源经 StateField 注入）
 *
 * 均只作用于代码围栏之外的行，视口内逐行扫描，性能安全。
 */

import { StateEffect, StateField, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'

/* ============================================================
   行内装饰：wikilink / ==高亮== / #标签 / callout 行
   ============================================================ */

const WIKILINK_RE = /(!?)\[\[([^\][\n]+?)\]\]/g
const HIGHLIGHT_RE = /==([^=\n]+)==/g
/** #标签：行首或空白/开括号后（负向排除 URL 锚点） */
const TAG_RE = /(^|[\s>(【[])#([A-Za-z_\u4e00-\u9fa5][\w/\u4e00-\u9fa5]*)/g
/** callout 首行：> [!type] */
const CALLOUT_RE = /^[ \t]*>[ \t]*\[!(\w+)/

interface ObsidianFile {
  id: number
  path: string
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = view.state.doc
  // 视口可能从文档中段开始：先把视口之前的围栏状态扫出来
  let inFence = false
  const firstVisible = view.visibleRanges[0]?.from ?? 0
  if (firstVisible > 0) {
    const endLine = doc.lineAt(firstVisible).number
    for (let n = 1; n < endLine; n++) {
      if (/^\s*(```|~~~)/.test(doc.line(n).text)) inFence = !inFence
    }
  }
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      const fenceLine = /^\s*(```|~~~)/.test(line.text)
      if (fenceLine) {
        inFence = !inFence
        pos = line.to + 1
        continue
      }
      if (!inFence) {
        // callout 标题行整行着色
        if (CALLOUT_RE.test(line.text)) {
          ranges.push(Decoration.line({ class: 'cm-callout-line' }).range(line.from))
        }
        // [[wikilink]] / ![[嵌入]]
        let m: RegExpExecArray | null
        WIKILINK_RE.lastIndex = 0
        while ((m = WIKILINK_RE.exec(line.text))) {
          const start = line.from + m.index
          ranges.push(
            Decoration.mark({
              class: m[1] ? 'cm-wikilink-embed' : 'cm-wikilink',
            }).range(start, start + m[0].length),
          )
        }
        // ==高亮==
        HIGHLIGHT_RE.lastIndex = 0
        while ((m = HIGHLIGHT_RE.exec(line.text))) {
          const start = line.from + m.index
          ranges.push(Decoration.mark({ class: 'cm-highlight' }).range(start, start + m[0].length))
        }
        // #标签（只给 #tag 部分上色，前导字符不算）
        TAG_RE.lastIndex = 0
        while ((m = TAG_RE.exec(line.text))) {
          const tagLen = m[2].length + 1
          const start = line.from + m.index + m[0].length - tagLen
          ranges.push(Decoration.mark({ class: 'cm-tag' }).range(start, start + tagLen))
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(ranges, true)
}

export const obsidianSyntaxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

/* ============================================================
   wikilink 自动补全
   ============================================================ */

/** 候选数据源经 StateField 注入，避免组件闭包过期 */
export const setLinkItems = StateEffect.define<ObsidianFile[]>()

export const linkItemsField = StateField.define<ObsidianFile[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinkItems)) return e.value
    return value
  },
})

/** [[file.md]] 与 [[file]] 等价：插入时去掉 .md 后缀（Obsidian 习惯） */
function linkLabel(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** 补全源：光标前是 "[[query" 时弹出文件名列表 */
function wikilinkSource(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[[^\][\n]*/)
  if (!before) return null
  if (before.from === before.to && !context.explicit) return null
  const query = context.state.sliceDoc(before.from + 2, context.pos).toLowerCase()
  const items = context.state.field(linkItemsField, false) ?? []
  const options: Completion[] = items
    .filter(
      (f) =>
        linkLabel(f.path).toLowerCase().includes(query) ||
        f.path.toLowerCase().includes(query),
    )
    .slice(0, 100)
    .map((f) => ({
      label: linkLabel(f.path),
      detail: f.path,
      type: 'text',
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const insert = `${linkLabel(f.path)}]]`
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        })
      },
    }))
  return { from: before.from + 2, options, validFor: /^[^\][\n]*$/ }
}

export const wikilinkCompletion = autocompletion({ override: [wikilinkSource] })

/** 初始化 state 的便捷方法 */
export function initLinkItems(items: ObsidianFile[]) {
  return linkItemsField.init(() => items)
}
