import { ArrowRight } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { REPO_URL } from '../i18n/content'
import { SpotlightCard } from './SpotlightCard'

export function Hero() {
  const { t } = useLang()

  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="hero-grid absolute inset-0" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="chip mb-6">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            {t.hero.badge}
          </div>

          <h1 className="text-4xl font-bold leading-[1.15] tracking-tight md:text-6xl">
            {t.hero.title1}
            <br />
            <span className="text-gradient">{t.hero.title2}</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted md:text-lg">
            {t.hero.subtitle}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#quickstart"
              className="group inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-all hover:bg-brand-strong hover:shadow-brand/50"
            >
              {t.hero.ctaPrimary}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-6 py-3 text-sm font-semibold text-muted transition-colors hover:border-brand/50 hover:text-ink"
            >
              {t.hero.ctaSecondary}
            </a>
          </div>

          <div className="mt-10 flex flex-wrap gap-2.5">
            {t.hero.chips.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        </div>

        <HeroDemo />
      </div>
    </section>
  )
}

function HeroDemo() {
  const { t } = useLang()

  return (
    <div className="relative" aria-hidden>
      <div className="absolute -inset-10 rounded-full bg-brand/10 blur-3xl" />
      <SpotlightCard className="card-glow relative rounded-2xl border border-line bg-surface/80 p-6 backdrop-blur">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-faint">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            {t.hero.demo.title}
          </div>
          <span className="font-mono text-[10px] text-faint">ws://nas:8787/ws</span>
        </div>

        <svg viewBox="0 0 400 300" className="w-full">
          {/* 连线：Mac → Server → Phone */}
          <path
            d="M80 90 C 160 90 160 150 200 150"
            className="flow-line"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="1.5"
            opacity="0.7"
          />
          <path
            d="M320 90 C 240 90 240 150 200 150"
            className="flow-line"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="1.5"
            opacity="0.7"
          />
          <path
            d="M200 150 L200 235"
            className="flow-line"
            fill="none"
            stroke="#7dd3fc"
            strokeWidth="1.5"
            opacity="0.7"
          />

          {/* Mac */}
          <g className="animate-float">
            <rect x="30" y="42" width="100" height="62" rx="10" fill="#191627" stroke="#2a2542" />
            <rect x="40" y="52" width="80" height="34" rx="4" fill="#0a0910" />
            <LaptopIcon />
            <text x="80" y="119" textAnchor="middle" fill="#a29bc0" fontSize="10">
              {t.hero.demo.mac}
            </text>
            <circle cx="118" cy="52" r="5" fill="#4ade80" opacity="0.9" />
          </g>

          {/* Phone */}
          <g className="animate-float-slow">
            <rect x="270" y="42" width="100" height="62" rx="10" fill="#191627" stroke="#2a2542" />
            <rect x="302" y="50" width="36" height="46" rx="6" fill="#0a0910" />
            <text x="320" y="119" textAnchor="middle" fill="#a29bc0" fontSize="10">
              {t.hero.demo.phone}
            </text>
            <circle cx="358" cy="52" r="5" fill="#4ade80" opacity="0.9" />
          </g>

          {/* Server */}
          <g>
            <rect x="140" y="118" width="120" height="64" rx="10" fill="#191627" stroke="#8b5cf6" strokeOpacity="0.5" />
            <ServerIcon />
            <text x="200" y="202" textAnchor="middle" fill="#c4b5fd" fontSize="10">
              {t.hero.demo.nas}
            </text>
          </g>

          {/* 日志流 */}
          <g fontSize="10" fontFamily="ui-monospace, monospace">
            <LogRow y={228} color="#a29bc0" text={t.hero.demo.saved} />
            <LogRow y={246} color="#7dd3fc" text={t.hero.demo.reconcile} />
            <LogRow y={264} color="#8b5cf6" text={t.hero.demo.broadcast} />
            <LogRow y={282} color="#4ade80" text={t.hero.demo.merged} />
          </g>
        </svg>

        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-mint">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          {t.hero.demo.syncDone}
        </div>
      </SpotlightCard>
    </div>
  )
}

function LaptopIcon() {
  return (
    <g transform="translate(68, 60)">
      <rect x="0" y="0" width="24" height="16" rx="2.5" fill="none" stroke="#a29bc0" strokeWidth="1.5" />
      <path d="M-3 19 L27 19" stroke="#a29bc0" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  )
}

function ServerIcon() {
  return (
    <g transform="translate(172, 130)">
      <rect x="0" y="0" width="56" height="12" rx="3" fill="#12101c" stroke="#8b5cf6" strokeWidth="1" />
      <rect x="0" y="17" width="56" height="12" rx="3" fill="#12101c" stroke="#8b5cf6" strokeWidth="1" />
      <circle cx="7" cy="6" r="1.6" fill="#4ade80" />
      <circle cx="7" cy="23" r="1.6" fill="#4ade80" />
      <rect x="16" y="4.5" width="30" height="3" rx="1.5" fill="#2a2542" />
      <rect x="16" y="21.5" width="30" height="3" rx="1.5" fill="#2a2542" />
    </g>
  )
}

function LogRow({ y, color, text }: { y: number; color: string; text: string }) {
  return (
    <g>
      <rect x="30" y={y - 10} width="340" height="15" rx="4" fill="#12101c" />
      <circle cx="38" cy={y - 2.5} r="2" fill={color} />
      <text x="47" y={y} fill={color} opacity="0.9">
        {text}
      </text>
    </g>
  )
}
