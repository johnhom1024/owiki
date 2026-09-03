import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { api, type SharedFileDetail } from '@/lib/api.ts'
import { preprocessObsidian } from '@/lib/obsidianMarkdown.ts'
import { markdownComponents } from '@/components/ObsidianRender.tsx'
import { Logo } from '@/components/Logo.tsx'
import { useLang } from '@/i18n/LangProvider.tsx'

/**
 * 公开分享页：/share/:token（免登录）。
 * 只读渲染一篇文章；wikilink/嵌入按「不存在」降级（访客没有 vault 导航上下文），
 * 图片附件经 /api/share/:token/attachments/* 放行。
 */

/** 分享页专用的预处理：不做 wikilink 解析（访客无跳转权限），只保留外观类转换 */
function preprocessShared(source: string, token: string) {
  // 附件嵌入：![[xxx.png]] 直接指向公开附件端点（按文件名，vault 根目录内有效）
  const pre = source.replace(/!\[\[([^\][]+?)\]\]/g, (whole, raw: string) => {
    const [rawTarget, alias] = raw.indexOf('|') !== -1
      ? [raw.slice(0, raw.indexOf('|')), raw.slice(raw.indexOf('|') + 1)]
      : [raw, undefined]
    const target = rawTarget.trim()
    if (!target) return whole
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(target)) {
      const width = alias && /^\d+$/.test(alias.trim()) ? ` width="${alias.trim()}"` : ''
      const alt = (alias && !/^\d+$/.test(alias.trim()) ? alias.trim() : target).replace(/"/g, '&quot;')
      return `<img class="obsidian-embed-image" src="/api/share/${token}/attachments/${encodeURI(target)}" alt="${alt}"${width} loading="lazy">`
    }
    return whole
  })
  // 复用主预处理（不传文件列表）：[[wikilink]] 全部走 unresolved 灰字样式，符合访客视角
  return preprocessObsidian(pre, 0, [])
}

export function SharedFilePage() {
  const { t } = useLang()
  const { token: tokenParam } = useParams()
  const token = tokenParam ?? ''
  const [file, setFile] = useState<SharedFileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError(t.sharedPage.notFound)
      return
    }
    let cancelled = false
    api
      .getSharedFile(token)
      .then((f) => {
        if (!cancelled) setFile(f)
      })
      .catch(() => {
        if (!cancelled) setError(t.sharedPage.notFound)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const fileTitle = file?.path.split('/').pop()?.replace(/\.md$/i, '')

  // 浏览器标题
  useEffect(() => {
    if (fileTitle) document.title = `OWiki · ${t.sharedPage.titlePrefix} · ${fileTitle}`
    return () => {
      document.title = 'OWiki'
    }
  }, [fileTitle])

  const rendered = useMemo(() => {
    if (!file) return null
    return preprocessShared(file.content, token)
  }, [file, token])

  return (
    <div className="bg-background min-h-screen">
      {/* 顶栏：Logo + 分享标识 */}
      <header className="bg-background/80 sticky top-0 z-10 border-b border-border/70 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[52rem] items-center gap-2 px-6">
          <Logo className="size-5" />
          <span className="text-sm font-semibold">OWiki</span>
          <span className="text-muted-foreground ml-1 text-xs">{t.sharedPage.tag}</span>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[42rem] px-6 pt-8 pb-24">
        {!file && !error && <p className="text-muted-foreground py-20 text-center">{t.common.loading}</p>}

        {error && (
          <div className="py-20 text-center">
            <p className="text-lg font-medium">{error}</p>
            <p className="text-muted-foreground mt-2 text-sm">
              {t.sharedPage.expiredHint}
            </p>
          </div>
        )}

        {file && rendered && (
          <article>
            <h1 className="inline-title">{fileTitle}</h1>

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

            <footer className="text-muted-foreground mt-16 flex items-center justify-between border-t pt-4 text-xs">
              <span>由 OWiki 分享</span>
              <span>{new Date(file.updatedAt).toLocaleDateString()}</span>
            </footer>
          </article>
        )}
      </section>
    </div>
  )
}
