import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'
import { SpotlightCard } from './SpotlightCard'

export function SyncHow() {
  const { t } = useLang()

  return (
    <section id="sync" className="border-y border-line-soft bg-surface/30 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.sync.title} subtitle={t.sync.subtitle} />

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {t.sync.steps.map((s) => (
            <SpotlightCard
              key={s.step}
              className="card-glow relative rounded-2xl border border-line bg-surface/80 p-6"
            >
              <span className="font-mono text-xs font-semibold text-brand">{s.step}</span>
              <h3 className="mt-2 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.desc}</p>
            </SpotlightCard>
          ))}
        </div>

        <SpotlightCard className="card-glow mt-12 overflow-hidden rounded-2xl border border-line bg-surface/80">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h3 className="text-sm font-semibold">{t.sync.protoTitle}</h3>
            <span className="font-mono text-[10px] text-faint">JSON frames over WebSocket</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-xs text-faint">
                  <th className="px-5 py-2.5 font-medium">dir</th>
                  <th className="px-5 py-2.5 font-medium">type</th>
                  <th className="px-5 py-2.5 font-medium">payload</th>
                </tr>
              </thead>
              <tbody>
                {t.sync.proto.map((row) => (
                  <tr
                    key={row.type}
                    className="border-b border-line-soft/60 transition-colors last:border-0 hover:bg-surface-2/50"
                  >
                    <td className="whitespace-nowrap px-5 py-3">
                      <span
                        className={
                          row.dir === 'C→S'
                            ? 'rounded-md bg-brand/15 px-2 py-0.5 font-mono text-xs text-brand-soft'
                            : 'rounded-md bg-sky/10 px-2 py-0.5 font-mono text-xs text-sky'
                        }
                      >
                        {row.dir}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink">
                      {row.type}
                    </td>
                    <td className="px-5 py-3 text-muted">{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3 text-xs text-faint">{t.sync.protoNote}</p>
        </SpotlightCard>
      </div>
    </section>
  )
}
