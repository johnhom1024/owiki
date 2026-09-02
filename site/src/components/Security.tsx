import { AlertTriangle, Database, EyeOff, Lock, Server, type LucideIcon } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'
import { SpotlightCard } from './SpotlightCard'

const icons: Record<string, LucideIcon> = {
  lock: Lock,
  database: Database,
  eyeOff: EyeOff,
  server: Server,
}

export function Security() {
  const { t } = useLang()

  return (
    <section id="security" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.security.title} subtitle={t.security.subtitle} />

        {/* 试验性阶段提醒（从页面顶部移入此区块） */}
        <div className="mx-auto mt-10 max-w-3xl rounded-xl border border-amber/25 bg-amber/[0.06] px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
            <p className="text-xs leading-relaxed text-amber/90 md:text-sm">
              <span className="font-semibold">{t.notice.title}</span>
              <span className="mx-2 text-amber/40" aria-hidden>
                ·
              </span>
              {t.notice.body}
            </p>
          </div>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.security.items.map((item) => {
            const Icon = icons[item.icon]
            return (
              <SpotlightCard key={item.title} className="card-glow rounded-2xl border border-line bg-surface/70 p-6">
                <div className="mb-4 inline-flex rounded-xl border border-mint/20 bg-mint/8 p-2.5">
                  <Icon className="h-5 w-5 text-mint" />
                </div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.desc}</p>
              </SpotlightCard>
            )
          })}
        </div>
      </div>
    </section>
  )
}
