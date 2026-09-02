import { BookOpen, FolderTree, Search, Smartphone } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'

/**
 * Wiki 区块：Obsidian vault 在浏览器里就是个人 wiki 网站。
 * 复用管理端首页截图（跟随站点语言）。
 */
export function Wiki() {
  const { t, lang } = useLang()
  const zh = lang === 'zh'
  const src = `${import.meta.env.BASE_URL}screenshots/${zh ? 'home-zh.jpg' : 'home-en.jpg'}`
  const alt = zh ? 'OWiki 个人 Wiki 网站' : 'OWiki as a personal wiki'

  const points = [
    { icon: FolderTree, text: t.wiki.pointBrowse },
    { icon: Search, text: t.wiki.pointSearch },
    { icon: BookOpen, text: t.wiki.pointRead },
    { icon: Smartphone, text: t.wiki.pointAnywhere },
  ]

  return (
    <section id="wiki" className="relative pb-20 md:pb-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" aria-hidden />
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.wiki.title} subtitle={t.wiki.subtitle} />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-[0.9fr_1.2fr]">
          <div>
            <p className="text-base leading-relaxed text-muted md:text-lg">{t.wiki.desc}</p>
            <ul className="mt-8 space-y-4">
              {points.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex rounded-lg border border-brand/25 bg-brand/10 p-2">
                    <Icon className="h-4 w-4 text-brand-soft" />
                  </span>
                  <span className="pt-1.5 text-sm leading-relaxed text-muted">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          <figure className="card-glow overflow-hidden rounded-2xl border border-line bg-surface/80 shadow-2xl shadow-black/30">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="mx-auto rounded-md border border-line bg-surface-2/60 px-3 py-0.5 font-mono text-[10px] text-faint">
                {zh ? 'owiki · 你的 Wiki' : 'owiki · your wiki'}
              </span>
            </div>
            <img
              src={src}
              alt={alt}
              width="2324"
              height="1780"
              loading="lazy"
              className="block w-full"
            />
          </figure>
        </div>
      </div>
    </section>
  )
}
