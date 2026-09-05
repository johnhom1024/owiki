import { Bot, CheckCircle2, ExternalLink, Sparkles } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { SKILL_RAW_URL } from '../i18n/content'
import { SectionHeading } from './Features'
import { CodeBlock, CopyButton } from './QuickStart'

export function OpenApi() {
  const { t } = useLang()

  return (
    <section id="openapi" className="border-y border-line-soft bg-surface/30 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.openapi.title} subtitle={t.openapi.subtitle} />

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-2">
          <div>
            <div className="mb-6 inline-flex rounded-xl border border-brand/25 bg-brand/10 p-2.5">
              <Bot className="h-6 w-6 text-brand-soft" />
            </div>
            <p className="text-sm leading-relaxed text-muted md:text-base">{t.openapi.desc}</p>
            <a
              href={SKILL_RAW_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-3 transition-colors hover:border-brand/60 hover:bg-brand/15"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-brand-soft">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  {t.openapi.skillBadge}
                </span>
                <span className="mt-1 block text-xs text-muted">{t.openapi.skillHint}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/20 px-3 py-1.5 text-xs font-medium text-ink">
                {t.openapi.skillCta}
                <ExternalLink className="h-3 w-3" />
              </span>
            </a>
            <ul className="mt-6 space-y-3">
              {t.openapi.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-muted">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="code-panel overflow-hidden rounded-2xl border border-line bg-surface-code">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold">{t.openapi.codeTitle}</h3>
              <CopyButton text={t.openapi.code} />
            </div>
            <CodeBlock code={t.openapi.code} />
          </div>
        </div>
      </div>
    </section>
  )
}
