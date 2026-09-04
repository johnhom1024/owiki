import { BookOpen, Bot, GitMerge, Globe, Puzzle, Radio, Share2, ShieldCheck, Zap, type LucideIcon } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { SpotlightCard } from './SpotlightCard'

const icons: Record<string, LucideIcon> = {
  zap: Zap,
  radio: Radio,
  gitMerge: GitMerge,
  globe: Globe,
  bookOpen: BookOpen,
  shieldCheck: ShieldCheck,
  bot: Bot,
  share2: Share2,
  puzzle: Puzzle,
}

export function Features() {
  const { t } = useLang()

  return (
    <section id="features" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.features.title} subtitle={t.features.subtitle} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((f) => {
            const Icon = icons[f.icon]
            return (
              <SpotlightCard
                key={f.title}
                className="card-glow rounded-2xl border border-line bg-surface/70 p-6"
              >
                <div className="mb-4 inline-flex rounded-xl border border-brand/25 bg-brand/10 p-2.5">
                  <Icon className="h-5 w-5 text-brand-soft" />
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.desc}</p>
              </SpotlightCard>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      <p className="mt-4 text-base text-muted md:text-lg">{subtitle}</p>
    </div>
  )
}
