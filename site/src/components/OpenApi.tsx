import { Bot, CheckCircle2, Sparkles } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
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
            <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-brand/30 bg-brand/10 px-4 py-2 text-xs text-brand-soft">
              <Sparkles className="h-3.5 w-3.5" />
              {t.openapi.skillBadge}
            </div>
            <ul className="mt-6 space-y-3">
              {t.openapi.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-muted">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-[#0d0b16]">
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
