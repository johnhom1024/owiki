import { useLang } from '../i18n/LangProvider'

/**
 * Hero 下的产品截图：展示 Web 管理端首页（跟随站点语言切换中/英截图）。
 * 图片来自 site/public/screenshots/，构建时原样拷贝。
 */
export function Screenshot() {
  const { lang } = useLang()
  const src = `${import.meta.env.BASE_URL}screenshots/${lang === 'en' ? 'home-en.jpg' : 'home-zh.jpg'}`
  const alt = lang === 'en' ? 'OWiki web console' : 'OWiki 管理端首页'

  return (
    <section className="relative pb-20 md:pb-28" aria-label={alt}>
      {/* 底部渐隐过渡，避免截图与背景生硬相接 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" aria-hidden />
      <div className="mx-auto max-w-5xl px-5">
        <div className="card-glow relative overflow-hidden rounded-2xl border border-line bg-surface/80 shadow-2xl shadow-black/30 backdrop-blur">
          {/* 浏览器窗口栏 */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="mx-auto rounded-md border border-line bg-surface-2/60 px-3 py-0.5 font-mono text-[10px] text-faint">
              owiki.local
            </span>
          </div>
          <img
            src={src}
            alt={alt}
            width="2324"
            height="1780"
            className="block w-full"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  )
}
