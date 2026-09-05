import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Copy, Github, Info, Menu, Moon, Search, Sun } from 'lucide-react'
import { useLang } from '@/i18n/LangProvider'
import { useTheme } from '@/i18n/ThemeProvider'
import { REPO_URL } from '@/i18n/content'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { docs, type DocPage } from './content'

const base = import.meta.env.BASE_URL
const readSlug = () => new URLSearchParams(location.search).get('page') || 'quickstart'
const pageHref = (slug: string, lang: string) => `${base}docs/?page=${encodeURIComponent(slug)}&lang=${lang}`

function CodeBlock({ language, value, en }: { language: string; value: string; en: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try { await navigator.clipboard.writeText(value); setStatus('copied') }
    catch { setStatus('error') }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 2500)
  }
  return <div className="my-6 overflow-hidden rounded-xl border border-line bg-page">
    <div className="flex items-center justify-between border-b border-line-soft bg-surface px-4 py-2">
      <span className="font-mono text-xs text-muted">{language}</span>
      <Button variant="ghost" onClick={copy} aria-label={en ? 'Copy code' : '复制代码'}>{status === 'copied' ? <Check /> : <Copy />}<span aria-live="polite">{status === 'copied' ? (en ? 'Copied' : '已复制') : status === 'error' ? (en ? 'Select and copy manually' : '请手动选择并复制') : (en ? 'Copy' : '复制')}</span></Button>
    </div>
    <pre tabIndex={0} className="overflow-x-auto p-5 text-[13px] leading-7 text-brand-soft outline-brand"><code>{value}</code></pre>
  </div>
}

export function Docs() {
  const { lang, toggle, setLang } = useLang()
  const { theme, toggle: toggleTheme } = useTheme()
  const en = lang === 'en'
  const pages = docs[lang]
  const [slug, setSlug] = useState(readSlug)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const page = pages.find(p => p.slug === slug)
  const index = pages.findIndex(p => p.slug === slug)
  const label = en ? 'Documentation' : '使用文档'

  useEffect(() => {
    const onPop = () => {
      const nextLang = new URLSearchParams(location.search).get('lang')
      if (nextLang === 'zh' || nextLang === 'en') setLang(nextLang)
      setSlug(readSlug())
      setOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [setLang])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('lang', lang)
    history.replaceState(null, '', url)
    document.title = `${page?.title || (en ? 'Page not found' : '页面不存在')} · OWiki ${label}`
    document.querySelector('meta[name="description"]')?.setAttribute('content', page?.description || label)
  }, [lang, page, en, label])

  useEffect(() => {
    setActive(page?.sections[0]?.id || '')
    setQuery('')
    const hash = location.hash.slice(1)
    if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: 'instant' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
    const onScroll = () => {
      const sections = page?.sections || []
      const current = [...sections].reverse().find(s => (document.getElementById(s.id)?.getBoundingClientRect().top ?? Infinity) <= 150)
      setActive(current?.id || sections[0]?.id || '')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [page])

  function navigate(event: MouseEvent<HTMLAnchorElement>, next: DocPage) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    history.pushState(null, '', pageHref(next.slug, lang))
    if (next.slug === slug) window.scrollTo({ top: 0, behavior: 'instant' })
    setSlug(next.slug)
    setOpen(false)
    setQuery('')
    requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }))
  }

  function navigation() {
    const filtered = pages.filter(p => `${p.title} ${p.description} ${p.sections.map(s => `${s.title} ${s.paragraphs?.join(' ') || ''}`).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    return <>
      <label className="mb-7 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-muted focus-within:border-brand">
        <Search className="size-4 shrink-0" /><input aria-label={en ? 'Search documentation' : '搜索文档'} placeholder={en ? 'Search documentation…' : '搜索文档…'} value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
      </label>
      <nav aria-label={label} className="space-y-7">
        {[...new Set(pages.map(p => p.group))].map(group => {
          const items = filtered.filter(p => p.group === group)
          return items.length > 0 && <div key={group}><p className="mb-2 px-3 text-xs font-semibold tracking-wide text-muted">{group}</p><div className="space-y-1">{items.map(p => <a key={p.slug} href={pageHref(p.slug, lang)} onClick={e => navigate(e, p)} aria-current={slug === p.slug ? 'page' : undefined} className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand', slug === p.slug ? 'border-brand/20 bg-brand/10 font-medium text-brand-soft' : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink')}>{p.title}{slug === p.slug && <ChevronRight className="size-3.5" />}</a>)}</div></div>
        })}
        {filtered.length === 0 && <p role="status" className="px-3 text-sm text-muted">{en ? 'No results. Try another keyword.' : '没有匹配的文档，试试其他关键词。'}</p>}
      </nav>
    </>
  }

  function toc() {
    return <nav aria-label={en ? 'On this page' : '本页目录'} className="space-y-3">{page?.sections.map(s => <a key={s.id} href={`#${s.id}`} aria-current={active === s.id ? 'location' : undefined} onClick={() => setActive(s.id)} className={cn('block border-l-2 pl-3 text-xs leading-5 transition-colors hover:text-ink', active === s.id ? 'border-brand text-brand-soft' : 'border-line text-muted')}>{s.title}</a>)}</nav>
  }

  return <div className="min-h-screen bg-page/80">
    <a href="#doc-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-[60] focus:rounded-lg focus:bg-brand focus:p-3">{en ? 'Skip to content' : '跳转到正文'}</a>
    <header className="sticky top-0 z-40 border-b border-line bg-page/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-5 lg:px-8">
        <div className="flex items-center gap-4"><a href={`${base}?lang=${lang}`} className="flex items-center gap-2.5" aria-label="OWiki"><Logo className="size-8" /><span className="text-lg font-semibold tracking-tight">OWiki</span></a><span className="hidden h-5 w-px bg-line sm:block" /><span className="hidden text-sm text-muted sm:block">{label}</span></div>
        <div className="flex items-center gap-1 sm:gap-3"><Button asChild variant="ghost" className="hidden sm:inline-flex"><a href={`${base}?lang=${lang}`}><ArrowLeft />{en ? 'Home' : '返回首页'}</a></Button><Button variant="ghost" onClick={toggle}>{en ? '中文' : 'English'}</Button><Button variant="outline" size="icon" onClick={toggleTheme} aria-label={en ? 'Switch theme' : '切换主题'} title={en ? 'Switch theme' : '切换主题'}>{theme === 'dark' ? <Sun /> : <Moon />}</Button><Button asChild variant="outline" size="icon"><a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub"><Github /></a></Button></div>
      </div>
    </header>
    <div className="sticky top-16 z-30 border-b border-line bg-page px-5 py-2 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost"><Menu />{label}<ChevronRight /><span className="max-w-40 truncate text-brand-soft">{page?.title}</span></Button></SheetTrigger><SheetContent closeLabel={en ? 'Close navigation' : '关闭导航'} onCloseAutoFocus={e => { if (document.activeElement === titleRef.current) e.preventDefault() }}><SheetTitle className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="size-5 text-brand-soft" />{label}</SheetTitle><SheetDescription className="mt-2 mb-6 text-xs text-muted">{en ? 'Everything you need to get started.' : '从首次部署到日常使用。'}</SheetDescription><div className="min-h-0 flex-1 overflow-y-auto">{navigation()}</div></SheetContent></Sheet>
    </div>
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]">
      <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto border-r border-line-soft px-6 py-9 lg:block">{navigation()}<div className="mt-10 border-t border-line-soft pt-5 text-xs leading-6 text-muted">OWiki / {en ? 'Self-hosted. Yours.' : '自部署，数据由你掌握。'}</div></aside>
      <main id="doc-content" className="min-w-0 px-5 py-9 sm:px-10 lg:px-12 lg:py-12">
        <article className="mx-auto max-w-[740px]">
          <div className="mb-6 flex items-center gap-2 text-xs text-muted"><BookOpen className="size-3.5 text-brand-soft" />{label}<ChevronRight className="size-3" />{page?.group || '404'}</div>
          <h1 ref={titleRef} tabIndex={-1} className="scroll-mt-32 text-3xl font-semibold tracking-tight outline-none sm:text-4xl">{page?.title || (en ? 'Page not found' : '页面不存在')}</h1>
          <p className="mt-5 text-base leading-8 text-muted">{page?.description || (en ? 'Choose a guide from the navigation to continue.' : '请从左侧导航选择一篇指南继续阅读。')}</p>
          {!page && <Button asChild className="mt-6"><a href={pageHref('quickstart', lang)}>{en ? 'Quick start' : '快速开始'}<ArrowRight /></a></Button>}
          {page && <>
            <div className="mt-8 border-b border-line-soft pb-8 xl:hidden"><details><summary className="cursor-pointer text-sm text-brand-soft">{en ? 'On this page' : '本页目录'}</summary><div className="mt-4">{toc()}</div></details></div>
            <div className="mt-10 space-y-12">{page.sections.map(section => <section key={section.id} id={section.id} className="!scroll-mt-36 lg:!scroll-mt-24">
              <h2 className="group text-xl font-semibold tracking-tight"><a href={`#${section.id}`} className="hover:text-brand-soft">{section.title}<span aria-hidden className="ml-2 text-muted opacity-0 group-hover:opacity-100">#</span></a></h2>
              {section.paragraphs?.map((text, i) => <p key={i} className="mt-4 text-sm leading-8 text-muted [overflow-wrap:anywhere]">{text}</p>)}
              {section.steps && <ol className="mt-5 space-y-4">{section.steps.map((text, i) => <li key={i} className="flex gap-3 text-sm leading-7 text-muted"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-brand/25 bg-brand/10 font-mono text-xs text-brand-soft">{i + 1}</span><span className="min-w-0 [overflow-wrap:anywhere]">{text}</span></li>)}</ol>}
              {section.code && <CodeBlock {...section.code} en={en} />}
              {section.notice && <div className="mt-6 flex gap-3 rounded-xl border border-amber/20 bg-amber/5 p-4 text-sm leading-7 text-muted"><Info className="mt-1 size-4 shrink-0 text-amber" /><p>{section.notice}</p></div>}
              {section.image && <figure className="mt-6"><img src={`${base}${section.image.src}`} alt={section.image.alt} loading="lazy" className="w-full rounded-xl border border-line" /><figcaption className="mt-3 text-center text-xs text-muted">{section.image.alt}</figcaption></figure>}
              {section.links && <div className="mt-5 flex flex-wrap gap-3">{section.links.map(link => <a key={link.href} href={link.href} target={link.href.startsWith('https://') ? '_blank' : undefined} rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-soft underline decoration-brand/30 underline-offset-4 hover:decoration-brand">{link.label}<ArrowRight className="size-3.5" /></a>)}</div>}
            </section>)}</div>
            <nav aria-label={en ? 'Previous and next pages' : '上一篇和下一篇'} className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">{[pages[index - 1], pages[index + 1]].map((p, i) => p ? <a key={p.slug} href={pageHref(p.slug, lang)} onClick={e => navigate(e, p)} className={cn('rounded-xl border border-line bg-surface/50 p-5 transition-colors hover:border-brand/50 hover:bg-surface-2', i === 1 && 'text-right')}><span className="text-xs text-muted">{i === 0 ? (en ? 'Previous' : '上一篇') : (en ? 'Next' : '下一篇')}</span><span className={cn('mt-2 flex items-center gap-2 text-sm font-medium text-brand-soft', i === 1 && 'justify-end')}>{i === 0 && <ArrowLeft className="size-4" />}{p.title}{i === 1 && <ArrowRight className="size-4" />}</span></a> : <div key={i} />)}</nav>
          </>}
          <footer className="mt-10 flex flex-wrap justify-between gap-3 text-xs text-muted"><span>OWiki · {en ? 'Made for your notes.' : '为你的笔记而生。'}</span><a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="hover:text-brand-soft">{en ? 'Questions or feedback? ↗' : '文档有问题？反馈给我们 ↗'}</a></footer>
        </article>
      </main>
      <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto px-5 py-12 xl:block"><p className="mb-5 text-xs font-medium text-muted">{en ? 'On this page' : '本页目录'}</p>{toc()}<div className="mt-8 border-t border-line-soft pt-5 text-xs leading-6 text-muted">{en ? 'Start small. Back up your vault before connecting.' : '从测试库开始。连接前，请先备份你的笔记。'}</div></aside>
    </div>
  </div>
}
