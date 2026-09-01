import { useLang } from '../i18n/LangProvider'
import { REPO_URL } from '../i18n/content'
import { Logo } from './Logo'

export function Footer() {
  const { t } = useLang()

  return (
    <footer className="border-t border-line bg-page">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-5 py-14">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-semibold">OWiki</span>
        </a>

        <p className="text-sm text-muted">{t.footer.tagline}</p>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <a href="#features" className="text-muted transition-colors hover:text-ink">
            {t.footer.links.product}
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-ink">
            {t.footer.links.repo}
          </a>
          <a
            href={`${REPO_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
            className="text-muted transition-colors hover:text-ink"
          >
            {t.footer.links.license}
          </a>
        </nav>

        <p className="text-xs text-faint">© 2026 johnhom · {t.footer.builtWith}</p>
      </div>
    </footer>
  )
}
