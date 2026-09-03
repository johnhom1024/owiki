/**
 * CodeMirror 6 封装：Obsidian 源码模式风格的 markdown 编辑器。
 *
 * 亮 / 暗主题走 CSS 变量（见 style.css `.cm-editor` 段落），不在这里写死颜色。
 * 语法高亮与 wikilink 补全见 lib/cmObsidian.ts；快捷键见 lib/cmMarkdownKeys.ts。
 */

import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  lineNumbers,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  initLinkItems,
  obsidianSyntaxPlugin,
  setLinkItems,
  wikilinkCompletion,
} from '@/lib/cmObsidian.ts'
import { markdownKeymap } from '@/lib/cmMarkdownKeys.ts'

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  /** wikilink 补全数据源：vault 内全部文件 */
  linkSuggestions?: { id: number; path: string }[]
}

/** markdown 语法高亮：颜色走 CSS 变量，对齐 Obsidian 阅读视图 */
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.35em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.25em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: t.heading4, fontSize: '1.05em', fontWeight: '600' },
  { tag: t.heading5, fontSize: '1.05em', fontWeight: '600' },
  { tag: t.heading6, fontSize: '1.05em', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--primary)' },
  { tag: t.url, color: 'var(--primary)' },
  { tag: t.quote, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--muted-foreground)' },
  { tag: t.list, color: 'var(--muted-foreground)' },
  { tag: t.monospace, fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  { tag: t.meta, color: 'var(--muted-foreground)' },
  { tag: t.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--cm-keyword, hsl(340 55% 48%))' },
  { tag: t.string, color: 'var(--cm-string, hsl(145 45% 38%))' },
  { tag: t.number, color: 'var(--cm-number, hsl(212 82% 45%))' },
  { tag: t.atom, color: 'var(--cm-number, hsl(212 82% 45%))' },
  { tag: t.bool, color: 'var(--cm-number, hsl(212 82% 45%))' },
])

export function MarkdownEditor({ value, onChange, onSave, linkSuggestions }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) return

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      closeBrackets(),
      wikilinkCompletion,
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSaveRef.current?.()
            return true
          },
        },
        ...markdownKeymap(),
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: false,
      }),
      obsidianSyntaxPlugin,
      syntaxHighlighting(markdownHighlight),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      EditorState.tabSize.of(2),
      initLinkItems(linkSuggestions ?? []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current,
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 初始化只跑一次；value / linkSuggestions 变化走单独 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部 value 变化（取消编辑还原草稿）→ 同步进编辑器，避免光标被重置
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
    }
  }, [value])

  // 补全数据源变化 → 更新 StateField
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setLinkItems.of(linkSuggestions ?? []),
    })
  }, [linkSuggestions])

  return <div ref={hostRef} className="markdown-editor-host" />
}
