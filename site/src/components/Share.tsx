import { ExternalLink, Link2, QrCode, ShieldCheck } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'

/**
 * 文章分享区块：宣传把笔记一键分享成公开只读链接的能力。
 * 截图跟随站点语言（share-zh.jpg / share-en.jpg）。
 */
export function Share() {
  const { t, lang } = useLang()
  const zh = lang === 'zh'

  const points = [
    { icon: Link2, text: t.share.pointLink },
    { icon: QrCode, text: t.share.pointQr },
    { icon: ShieldCheck, text: t.share.pointControl },
    { icon: ExternalLink, text: t.share.pointReadonly },
  ]

  return (
    <section id="share" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.share.title} subtitle={t.share.subtitle} />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          {/* 左：文案要点 */}
          <div>
            <p className="text-base leading-relaxed text-muted md:text-lg">{t.share.desc}</p>
            <ul className="mt-8 space-y-4">
              {points.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex rounded-lg border border-mint/25 bg-mint/10 p-2">
                    <Icon className="h-4 w-4 text-mint" />
                  </span>
                  <span className="pt-1.5 text-sm leading-relaxed text-muted">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 右：分享面板截图（跟随语言） */}
          <figure className="card-glow overflow-hidden rounded-2xl border border-line bg-surface/80 shadow-2xl shadow-[var(--c-shadow-img)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="mx-auto rounded-md border border-line bg-surface-2/60 px-3 py-0.5 font-mono text-[10px] text-faint">
                {zh ? 'owiki · 文章分享' : 'owiki · share'}
              </span>
            </div>
            <img
              src={`${import.meta.env.BASE_URL}screenshots/${zh ? 'share-zh.jpg' : 'share-en.jpg'}`}
              alt={zh ? 'OWiki 文章分享' : 'OWiki note sharing'}
              width="2004"
              height="890"
              loading="lazy"
              className="block w-full"
            />
          </figure>
        </div>
      </div>
    </section>
  )
}
