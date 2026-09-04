import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, ChevronLeft, Columns2, Pencil } from 'lucide-react'
import { api, ConflictError, type FileDetail, type FileMeta } from '@/lib/api.ts'
import { useFeatures } from '@/lib/features.tsx'
import { NoteReadingView } from '@/components/NoteReadingView.tsx'
import { ShareButton } from '@/components/ShareButton.tsx'
import { useLang } from '@/i18n/LangProvider.tsx'
import { cn } from '@/lib/utils.ts'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'

const MarkdownEditor = lazy(() =>
  import('@/components/MarkdownEditor.tsx').then((m) => ({ default: m.MarkdownEditor })),
)

/** 三种视图：阅读 / 源码 / 分屏（同 Obsidian） */
type ViewMode = 'reading' | 'source' | 'split'

const VIEW_CYCLE: ViewMode[] = ['reading', 'source', 'split']

function draftKey(fileId: number) {
  return `owiki-draft:${fileId}`
}

export function FileViewPage() {
  const { vid, id } = useParams()
  const { t } = useLang()
  const { isEnabled: featureEnabled } = useFeatures()
  const navigate = useNavigate()
  const fileId = Number(id)

  const [file, setFile] = useState<FileDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [baseHash, setBaseHash] = useState('')
  const [view, setView] = useState<ViewMode>('reading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vaultFiles, setVaultFiles] = useState<FileMeta[]>([])
  const [vaultName, setVaultName] = useState('')
  const [conflict, setConflict] = useState<{
    serverContent: string
    serverHash: string
    mergedHint: string
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [forceNext, setForceNext] = useState(false)
  const [dirty, setDirty] = useState(false)

  const editorPaneRef = useRef<HTMLDivElement>(null)
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => {})
  const [preview, setPreview] = useState('')

  // 当前 vault 的文件列表（wikilink 解析 + 补全），只在进入页面时拉一次
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

  // 切文章时回到阅读模式，避免上一篇的编辑态残留
  useEffect(() => {
    setView('reading')
    setNotice(null)
    setError(null)
    setConflict(null)
  }, [fileId])

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getFile(fileId)
      .then((f) => {
        if (cancelled) return
        setFile(f)
        setBaseHash(f.contentHash)
        setConflict(null)
        setForceNext(false)
        // 本地草稿优先（刷新不丢稿），但内容必须与服务器不同才算 dirty
        try {
          const cached = localStorage.getItem(draftKey(fileId))
          if (cached && cached !== f.content) {
            setDraft(cached)
            setDirty(true)
            setNotice(t.fileView.draftRestored)
          } else {
            setDraft(f.content)
            setDirty(false)
            localStorage.removeItem(draftKey(fileId))
          }
        } catch {
          setDraft(f.content)
          setDirty(false)
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : t.common.loadFailed)
      })
    return () => {
      cancelled = true
    }
  }, [fileId, t])

  // 浏览器标题：OWiki · vault 名 · 文章标题
  const fileTitle = file?.path.split('/').pop()?.replace(/\.md$/i, '')
  useEffect(() => {
    if (fileTitle && vaultName) {
      document.title = `OWiki · ${vaultName} · ${fileTitle}`
    }
    return () => {
      document.title = 'OWiki'
    }
  }, [fileTitle, vaultName])

  const onDraftChange = (next: string) => {
    setDraft(next)
    const isDirty = next !== (file?.content ?? '')
    setDirty(isDirty)
    try {
      if (isDirty) localStorage.setItem(draftKey(fileId), next)
      else localStorage.removeItem(draftKey(fileId))
    } catch {
      /* quota */
    }
  }

  // 保存后的同步回执：插件 fetch 落盘后服务端推 note.synced，提示升级为“已同步”，
  // 4s 后自动收起。插件离线时停在“正在同步”，语义准确（确实还没同步）。
  //
  // 两个竞态都要接住：
  // 1) 插件 fetch 可能快于保存的 HTTP 响应 → waiting 判定含 saving 阶段；
  // 2) 回执先到、响应后到 → save 成功路径用函数式 setNotice，不把“已同步”盖回“正在同步”。
  // 监听器 deps 只用原始值（vaultId/path），notice/saving 走 ref 镜像，
  // 避免 effect 随状态翻新而重挂、顺手清掉 4s 收起定时器。
  const syncWaitRef = useRef({ saving, notice })
  syncWaitRef.current = { saving, notice }
  const curVaultId = file?.vaultId
  const curPath = file?.path
  useEffect(() => {
    if (curVaultId === undefined || curPath === undefined) return
    let timer: number | undefined
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ vaultId: number; path: string }>).detail
      if (!detail || detail.vaultId !== curVaultId || detail.path !== curPath) return
      const { saving: s, notice: n } = syncWaitRef.current
      if (!(s || n === t.fileView.saved || n === t.fileView.merged)) return
      setNotice(t.fileView.syncedToClients)
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => setNotice(null), 4000)
    }
    window.addEventListener('owiki-note-synced', onSynced)
    return () => {
      window.removeEventListener('owiki-note-synced', onSynced)
      if (timer) window.clearTimeout(timer)
    }
  }, [curVaultId, curPath, t])

  // 分屏预览防抖：避免每个按键都跑一遍 Obsidian 预处理 + react-markdown
  useEffect(() => {
    if (view !== 'split') {
      setPreview(draft)
      return
    }
    const id = window.setTimeout(() => setPreview(draft), 160)
    return () => window.clearTimeout(id)
  }, [draft, view])

  const save = async (force = false) => {
    if (!file) return
    if (!force && !forceNext && draft === file.content) return
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
      setDirty(false)
      try {
        localStorage.removeItem(draftKey(fileId))
      } catch {
        /* ignore */
      }
      // 回执可能先于本响应到达（插件 fetch 更快）：已是“已同步”就不再降级
      setNotice((prev) =>
        prev === t.fileView.syncedToClients
          ? prev
          : res.merged
            ? t.fileView.merged
            : t.fileView.saved,
      )
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
  saveRef.current = save

  const cancelEdit = () => {
    setDraft(file?.content ?? '')
    setDirty(false)
    setConflict(null)
    setView('reading')
    try {
      localStorage.removeItem(draftKey(fileId))
    } catch {
      /* ignore */
    }
  }

  const cycleView = () => {
    setView((v) => VIEW_CYCLE[(VIEW_CYCLE.indexOf(v) + 1) % VIEW_CYCLE.length])
  }

  // Cmd+E 切换视图；未保存离开时浏览器提醒
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void saveRef.current()
        return
      }
      if (k !== 'e') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      cycleView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 关标签 / 刷新 / 关掉窗口：浏览器原生提示（文案由浏览器决定，不可自定义）
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // 应用内跳转（返回 vault、侧栏点别的文章、浏览器后退）：自定义确认弹窗
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  )

  /** 分屏滚动同步：按百分比对齐，避免一侧滚动时无限循环 */
  const syncScroll = (src: HTMLElement, dst: HTMLElement) => {
    if (syncingRef.current) return
    const srcMax = src.scrollHeight - src.clientHeight
    const dstMax = dst.scrollHeight - dst.clientHeight
    if (srcMax <= 0 || dstMax <= 0) return
    syncingRef.current = true
    dst.scrollTop = (src.scrollTop / srcMax) * dstMax
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }

  const onEditorScroll = (e: UIEvent<HTMLDivElement>) => {
    const dst = previewPaneRef.current
    if (dst) syncScroll(e.currentTarget, dst)
  }
  const onPreviewScroll = (e: UIEvent<HTMLDivElement>) => {
    const dst = editorPaneRef.current
    if (dst) syncScroll(e.currentTarget, dst)
  }

  const crumbs = file?.path.split('/') ?? []
  const isEditing = view !== 'reading'
  const isSplit = view === 'split'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 文档头：面包屑 + 视图切换 + 操作按钮（吸顶，Obsidian view-header 式） */}
      <header className="bg-background/80 sticky top-0 z-10 shrink-0 border-b border-border/70 backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-none items-center gap-2 px-4">
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
                <span className={cn(i === crumbs.length - 1 && 'text-foreground font-medium')}>
                  {seg}
                  {i === crumbs.length - 1 && dirty && (
                    <span className="bg-primary ml-1.5 inline-block size-1.5 rounded-full align-middle" title="unsaved" />
                  )}
                </span>
              </span>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* 视图切换：阅读 / 源码 / 分屏 */}
            <div className="bg-muted/60 mr-1 hidden items-center rounded-md p-0.5 sm:flex">
              <ViewBtn
                active={view === 'reading'}
                title={t.fileView.viewReading}
                onClick={() => setView('reading')}
              >
                <BookOpen className="size-3.5" />
              </ViewBtn>
              <ViewBtn
                active={view === 'source'}
                title={t.fileView.viewSource}
                onClick={() => setView('source')}
              >
                <Pencil className="size-3.5" />
              </ViewBtn>
              <ViewBtn
                active={view === 'split'}
                title={t.fileView.viewSplit}
                onClick={() => setView('split')}
              >
                <Columns2 className="size-3.5" />
              </ViewBtn>
            </div>
            {file && view === 'reading' && featureEnabled('share') && <ShareButton fileId={file.id} />}
            {view === 'reading' && (
              <Button size="sm" onClick={() => setView('source')}>
                <Pencil /> {t.fileView.edit}
              </Button>
            )}
            {view !== 'reading' && (
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                {t.common.cancel}
              </Button>
            )}
            {(view !== 'reading' || dirty) && (
              <Button size="sm" disabled={saving || !dirty} onClick={() => void save(false)}>
                {saving ? t.common.saving : t.common.save}
              </Button>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <div className="shrink-0 px-4 pt-3">
          <div className="rounded-md border border-primary/25 bg-primary/10 px-4 py-2 text-sm">{notice}</div>
        </div>
      )}
      {error && (
        <div className="shrink-0 px-4 pt-3">
          <div className="bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">{error}</div>
        </div>
      )}
      {conflict && (
        <div className="shrink-0 px-4 pt-3">
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
                  setDirty(false)
                  setView('reading')
                  setNotice(t.fileView.droppedLocal)
                }}
              >
                {t.fileView.useRemote}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(conflict.mergedHint || draft)
                  setConflict(null)
                  setForceNext(true)
                  setDirty(true)
                  setNotice(t.fileView.insertedMarkers)
                }}
              >
                {t.fileView.viewConflict}
              </Button>
            </div>
          </div>
        </div>
      )}

      {!file && !error && (
        <p className="text-muted-foreground flex-1 py-20 text-center">{t.common.loading}</p>
      )}

      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.fileView.unsavedTitle}</DialogTitle>
            <DialogDescription>{t.fileView.unsavedDesc}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              {t.fileView.stay}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              {t.fileView.leaveAnyway}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {file && (
        <div
          className={cn(
            'flex min-h-0 flex-1',
            isSplit ? 'flex-col md:flex-row' : 'flex-col',
          )}
        >
          {/* 源码 / 分屏左侧：编辑器 */}
          {isEditing && (
            <div
              ref={editorPaneRef}
              onScroll={isSplit ? onEditorScroll : undefined}
              className={cn(
                'min-h-0 overflow-y-auto',
                isSplit ? 'h-1/2 border-b md:h-auto md:min-h-0 md:w-1/2 md:border-r md:border-b-0' : 'flex-1',
              )}
            >
              <Suspense fallback={<p className="text-muted-foreground p-6 text-sm">{t.common.loading}</p>}>
                <MarkdownEditor
                  key={file.id}
                  value={draft}
                  onChange={onDraftChange}
                  onSave={() => void save(false)}
                  linkSuggestions={vaultFiles}
                />
              </Suspense>
            </div>
          )}

          {/* 阅读 / 分屏右侧：预览（复用同一套渲染） */}
          {(view === 'reading' || isSplit) && (
            <div
              ref={previewPaneRef}
              onScroll={isSplit ? onPreviewScroll : undefined}
              className={cn(
                'min-h-0 overflow-y-auto',
                isSplit ? 'h-1/2 md:h-auto md:min-h-0 md:w-1/2' : 'flex-1',
              )}
            >
              <section
                className={cn(
                  'mx-auto w-full px-6 pt-8 pb-24',
                  isSplit ? 'max-w-none' : 'max-w-[42rem]',
                )}
              >
                <NoteReadingView
                  content={view === 'split' ? preview : draft}
                  vaultId={file.vaultId}
                  path={file.path}
                  files={vaultFiles}
                />
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ViewBtn({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-sm',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
