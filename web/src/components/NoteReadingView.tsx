/**
 * 笔记阅读视图：Obsidian 风格 markdown 渲染。
 *
 * 阅读模式与分屏预览共用这一份，保证两边渲染 100% 一致。
 * 附件（图片）走独立分支；markdown 走 preprocessObsidian + react-markdown。
 */

import { useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { preprocessObsidian } from '@/lib/obsidianMarkdown.ts'
import { markdownComponents } from '@/components/ObsidianRender.tsx'
import { useLang } from '@/i18n/LangProvider.tsx'

export interface NoteReadingViewProps {
  content: string
  vaultId: number
  path: string
  files: { id: number; path: string }[]
  /** 分屏预览时隐藏大标题（源码侧已有文件名） */
  hideTitle?: boolean
}

const ATTACH_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf)$/i

export function NoteReadingView({
  content,
  vaultId,
  path,
  files,
  hideTitle,
}: NoteReadingViewProps) {
  const { t } = useLang()
  const fileTitle = path.split('/').pop()?.replace(/\.md$/i, '') ?? path
  const isAttachment = ATTACH_RE.test(path)

  const rendered = useMemo(
    () =>
      preprocessObsidian(content, vaultId, files, {
        attachNotSynced: t.obsidian.attachNotSynced,
        embedNote: t.obsidian.embedNote,
        notFound: t.obsidian.notFound,
      }),
    [content, vaultId, files, t],
  )

  if (isAttachment) {
    return (
      <article>
        {!hideTitle && <h1 className="inline-title">{fileTitle}</h1>}
        <div className="mt-6 flex justify-center">
          <img
            src={`/api/vaults/${vaultId}/attachments/${encodeURI(path)}`}
            alt={path}
            className="max-w-full rounded-lg border shadow-sm"
          />
        </div>
      </article>
    )
  }

  return (
    <article>
      {!hideTitle && <h1 className="inline-title">{fileTitle}</h1>}

      {rendered.properties.length > 0 && (
        <div className="obsidian-properties">
          {rendered.properties.map((p) => (
            <div className="property-row" key={p.key}>
              <span className="property-key">{p.key}</span>
              <span className="property-value">{p.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="markdown-body prose prose-zinc dark:prose-invert max-w-none">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight]}
          components={{
            a: ({ href, children }) => {
              const internal = href?.startsWith('/') || href?.startsWith('#')
              return internal ? (
                <a href={href}>{children}</a>
              ) : (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              )
            },
            ...markdownComponents,
          }}
        >
          {rendered.markdown}
        </Markdown>
      </div>
    </article>
  )
}
