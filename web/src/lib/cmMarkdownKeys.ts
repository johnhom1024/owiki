/**
 * Obsidian 源码模式风格的 markdown 快捷键（CodeMirror 6 命令）。
 *
 *   Mod-B  加粗（toggle **...**）
 *   Mod-I  斜体（toggle *...*）
 *   Mod-K  插入 []()，光标落进 []
 *   Mod-L  切换当前行 checkbox（- [ ] ↔ - [x]）
 *   Enter  列表内自动续行（空项则取消列表）
 *
 * 全部是 Command：返回 true 表示已处理，CM 不再走默认行为。
 */

import { EditorView, type Command, type KeyBinding } from '@codemirror/view'

/** 取选区；无选区时取光标所在词（中英文），用于包裹 **bold** 等 */
function targetRange(view: EditorView): { from: number; to: number } {
  const sel = view.state.selection.main
  if (!sel.empty) return { from: sel.from, to: sel.to }
  const line = view.state.doc.lineAt(sel.head)
  const isWord = (c: string) => /[\w\u4e00-\u9fa5]/.test(c)
  let s = sel.head - line.from
  let e = s
  while (s > 0 && isWord(line.text[s - 1])) s--
  while (e < line.text.length && isWord(line.text[e])) e++
  return { from: line.from + s, to: line.from + e }
}

/** 包裹选区/光标词；已有包裹时反操作（toggle） */
export function wrapSelection(prefix: string, suffix = prefix): Command {
  return (view) => {
    const { from, to } = targetRange(view)
    const selected = view.state.sliceDoc(from, to)
    if (
      selected.startsWith(prefix) &&
      selected.endsWith(suffix) &&
      selected.length > prefix.length + suffix.length
    ) {
      const inner = selected.slice(prefix.length, selected.length - suffix.length)
      view.dispatch({
        changes: { from, to, insert: inner },
        selection: { anchor: from, head: from + inner.length },
      })
      return true
    }
    view.dispatch({
      changes: { from, to, insert: `${prefix}${selected}${suffix}` },
      selection: { anchor: from + prefix.length, head: to + prefix.length },
    })
    return true
  }
}

/** 有选区时把选区包成 [text]()，否则插入 []()，光标落进 [] / ()（Obsidian 行为） */
export const insertLink: Command = (view) => {
  const sel = view.state.selection.main
  if (!sel.empty) {
    const selected = view.state.sliceDoc(sel.from, sel.to)
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `[${selected}]()` },
      selection: { anchor: sel.from + selected.length + 3 },
    })
    return true
  }
  const pos = sel.head
  view.dispatch({
    changes: { from: pos, insert: '[]()' },
    selection: { anchor: pos + 1 },
  })
  return true
}

/** 切换当前行 checkbox（- [ ] ↔ - [x]）；非列表行则变成 `- [ ] ...` */
export const toggleTask: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.from)
  const m = /^(\s*(?:[-*+]|\d+\.)\s+\[)( |x)(\])/.exec(line.text)
  let insert: string
  if (m) {
    insert = line.text.replace(m[0], `${m[1]}${m[2] === 'x' ? ' ' : 'x'}${m[3]}`)
  } else {
    const lm = /^(\s*)(?:([-*+]|\d+\.)\s+)?(.*)$/.exec(line.text)
    if (!lm) return false
    insert = `${lm[1]}${lm[2] ?? '-'} [ ] ${lm[3]}`
  }
  view.dispatch({ changes: { from: line.from, to: line.to, insert } })
  return true
}

/**
 * Enter：列表内自动续行（含任务列表）。
 * 空列表项回车则取消列表（同 Obsidian）；非列表行返回 false 走默认换行。
 */
export const continueList: Command = (view) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const line = view.state.doc.lineAt(sel.head)
  const m = /^(\s*)([-*+]|\d+\.)\s+(\[[ x]\]\s+)?(.*)$/.exec(line.text)
  if (!m) return false
  const [, indent, marker, task, content] = m
  const caretAt = sel.head - line.from
  const prefixEnd = line.text.length - content.length
  if (caretAt < prefixEnd - (task?.length ?? 0)) return false
  if (!content.trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
    })
    return true
  }
  const numberMatch = /^(\d+)\.$/.exec(marker)
  const nextMarker = numberMatch ? `${Number(numberMatch[1]) + 1}.` : marker
  const insert = `\n${indent}${nextMarker} ${task ?? ''}`
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
  })
  return true
}

/** 编辑器快捷键绑定（不含 Mod-S，保存由组件层注入） */
export function markdownKeymap(): KeyBinding[] {
  return [
    { key: 'Mod-b', run: wrapSelection('**') },
    { key: 'Mod-i', run: wrapSelection('*') },
    { key: 'Mod-k', run: insertLink },
    { key: 'Mod-l', run: toggleTask },
    { key: 'Enter', run: continueList },
  ]
}
