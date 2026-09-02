import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { ChevronLeft, Pencil } from 'lucide-react'
import { api, ConflictError, type FileDetail, type FileMeta } from '@/lib/api.ts'
import { preprocessObsidian } from '@/lib/obsidianMarkdown.ts'
import { markdownComponents } from '@/components/ObsidianRender.tsx'
import { ShareButton } from '@/components/ShareButton.tsx'
import { useLang } from '@/i18n/LangProvider.tsx'
import { cn } from '@/lib/utils.ts'
import { Button } from '@/components/ui/button.tsx'

export function FileViewPage() {
  const { vid, id } = useParams()
  const { t } = useLang()
  const navigate = useNavigate()
  const fileId = Number(id)

  const [file, setFile] = useState<FileDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [baseHash, setBaseHash] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vaultFiles, setVaultFiles] = useState<FileMeta[]>([])
  const [vaultName, setVaultName] = useState('')

  // 当前 vault 的文件列表（wikilink 解析用），只在进入页面时拉一次
  useEffect(() => {
    const v = Number(vid)
    if (!Number.isFinite(v)) return
    api
      .listVaultFiles(v)
      .then((r) => setVaultFiles(r.data))
      .catch(() => setVaultFiles([]))
    api
      .getVault(v)
      .then((s) => setVaultName(s.data.name))
      .catch(() => setVaultName(''))
  }, [vid])
  const [conflict, setConflict] = useState<{
    serverContent: string
    serverHash: string
    mergedHint: string
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [forceNext, setForceNext] = useState(false)

  const load = useCallback(() => {
    setError(null)
    api
      .getFile(fileId)
      .then((f) => {
        setFile(f)
        setDraft(f.content)
        setBaseHash(f.contentHash)
        setConflict(null)
        setForceNext(false)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t.common.loadFailed))
  }, [fileId])

  useEffect(() => {
    load()
  }, [load])

  // 浏览器标题：OWiki · vault 名 · 文章标题（文件名去 .md 后缀）
  const fileTitle = file?.path.split('/').pop()?.replace(/\.md$/i, '')
  useEffect(() => {
    if (fileTitle && vaultName) {
      document.title = `OWiki · ${vaultName} · ${fileTitle}`
    }
    return () => {
      document.title = 'OWiki'
    }
  }, [fileTitle, vaultName])

  const save = async (force = false) => {
    if (!file) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.saveFile(file.id, {
        content: draft,
        baseHash,
        force: force || forceNext,
      })
      setFile(res.data)
      setDraft(res.data.content)
      setBaseHash(res.data.contentHash)
      setConflict(null)
      setForceNext(false)
      setEditing(false)
      setNotice(res.merged ? t.fileView.merged : t.fileView.saved)
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflict({
          serverContent: e.serverContent,
          serverHash: e.serverHash,
          mergedHint: e.mergedHint,
        })
      } else {
        setError(e instanceof Error ? e.message : t.common.saveFailed)
      }
    } finally {
      setSaving(false)
    }
  }

  // Obsidian 语法预处理（wikilink / 图片嵌入），仅在阅读模式做
  const rendered = useMemo(() => {
    if (!file) return null
    return preprocessObsidian(file.content, file.vaultId, vaultFiles, {
      attachNotSynced: t.obsidian.attachNotSynced,
      embedNote: t.obsidian.embedNote,
      notFound: t.obsidian.notFound,
    })
  }, [file, vaultFiles, t])

  // 附件（图片等二进制）：详情页直接展示本体
  const isAttachment = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf)$/i.test(file?.path ?? '')

  const crumbs = file?.path.split('/') ?? []

  return (
    <div>
      {/* 文档头：面包屑 + 操作按钮（吸顶，Obsidian view-header 式） */}
      <header className="bg-background/80 sticky top-0 z-10 border-b border-border/70 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[52rem] items-center gap-2 px-6">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            title={t.fileView.backToVault}
            onClick={() => navigate(`/vaults/${vid}`)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <nav className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={file?.path}>
            {crumbs.map((seg, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1 opacity-50">/</span>}
                <span className={cn(i === crumbs.length - 1 && 'text-foreground font-medium')}>{seg}</span>
              </span>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* 分享：开启后外链 /share/<token> 免登录可看 */}
            {file && !editing && <ShareButton fileId={file.id} />}
            {!editing ? (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil /> {t.fileView.edit}
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false)
                    setDraft(file?.content ?? '')
                    setConflict(null)
                  }}
                >
                  {t.common.cancel}
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void save(false)}>
                  {saving ? t.common.saving : t.common.save}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 正文：无卡片，直接铺在背景上，Obsidian 可读行宽居中 */}
      <section className="mx-auto w-full max-w-[42rem] px-6 pt-8 pb-24">

      {notice && (
        <div className="mb-4 rounded-md border border-primary/25 bg-primary/10 px-4 py-3 text-sm">
          {notice}
        </div>
      )}
      {error && (
        <div className="bg-destructive/10 text-destructive mb-4 rounded-md border px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {conflict && (
        <div className="mb-4 space-y-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{t.fileView.conflictTitle}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save(true)}>
              {t.fileView.overwriteRemote}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(conflict.serverContent)
                setBaseHash(conflict.serverHash)
                setFile(
                  file
                    ? { ...file, content: conflict.serverContent, contentHash: conflict.serverHash }
                    : file,
                )
                setConflict(null)
                setEditing(false)
                setNotice(t.fileView.droppedLocal)
              }}
            >
              用远程的
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(conflict.mergedHint || draft)
                setConflict(null)
                setForceNext(true)
                setNotice(t.fileView.insertedMarkers)
              }}
            >
              {t.fileView.viewConflict}
            </Button>
          </div>
        </div>
      )}

      {!file && !error && <p className="text-muted-foreground py-20 text-center">{t.common.loading}</p>}

      {file && editing && (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="focus:ring-ring/50 min-h-[480px] w-full resize-y rounded-lg border bg-transparent p-4 font-mono text-sm leading-relaxed focus:ring-[3px] focus:outline-none"
        />
      )}

      {file && !editing && isAttachment && (
        <article>
          <h1 className="inline-title">{file.path.split('/').pop()}</h1>
          <div className="mt-6 flex justify-center">
            <img
              src={`/api/vaults/${file.vaultId}/attachments/${encodeURI(file.path)}`}
              alt={file.path}
              className="max-w-full rounded-lg border shadow-sm"
            />
          </div>
        </article>
      )}

      {file && !editing && !isAttachment && rendered && (
        <article>
          {/* Obsidian 内联标题：大字号直接铺在背景上 */}
          <h1 className="inline-title">{fileTitle}</h1>

          {/* YAML frontmatter 属性面板 */}
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
                // 文章内超链接默认新标签页打开（站内跳转除外）
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
                // callout：读取预处理标记，渲染 Obsidian 彩色引用块
                ...markdownComponents,
              }}
            >
              {rendered.markdown}
            </Markdown>
          </div>
        </article>
      )}
    </section>
    </div>
  )
}
