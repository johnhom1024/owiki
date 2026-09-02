import { useEffect, useState } from 'react'
import { Github, Menu, X } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { REPO_URL } from '../i18n/content'
import { Logo } from './Logo'
import { cn } from '../lib/utils'

export function Header() {
  const { t, toggle } = useLang()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { href: '#wiki', label: t.nav.wiki },
    { href: '#features', label: t.nav.features },
    { href: '#architecture', label: t.nav.architecture },
    { href: '#sync', label: t.nav.sync },
    { href: '#quickstart', label: t.nav.quickstart },
    { href: '#openapi', label: t.nav.openapi },
    { href: '#security', label: t.nav.security },
    { href: '#faq', label: t.nav.faq },
  ]

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled ? 'glass border-b border-line' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">OWiki</span>
        </a>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="rounded-full border border-line bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/50 hover:text-ink"
          >
            {t.nav.langToggle}
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2/60 px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/50 hover:text-ink sm:inline-flex"
          >
            <Github className="h-3.5 w-3.5" />
            {t.nav.source}
          </a>
          <button
            className="text-muted md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="glass border-t border-line px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}
