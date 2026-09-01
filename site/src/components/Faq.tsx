import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'
import { SpotlightCard } from './SpotlightCard'

export function Faq() {
  const { t } = useLang()

  return (
    <section id="faq" className="border-t border-line-soft bg-surface/30 py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-5">
        <SectionHeading title={t.faq.title} subtitle="" />

        <div className="mt-12 space-y-4">
          {t.faq.items.map((item) => (
            <SpotlightCard
              key={item.q}
              className="rounded-xl border border-line bg-surface/60 p-5 md:p-6"
            >
              <h3 className="text-sm font-semibold md:text-base">{item.q}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">{item.a}</p>
            </SpotlightCard>
          ))}
        </div>
      </div>
    </section>
  )
}
