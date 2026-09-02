import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { useLang } from '../i18n/LangProvider'
import { SectionHeading } from './Features'
import { cn } from '../lib/utils'

/** 插件设置页截图（quickstart 第 3 步用）：跟随站点语言 */
function PluginScreenshot() {
  const { lang } = useLang()
  const zh = lang === 'zh'
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-surface/80 shadow-xl shadow-black/20">
      <img
        src={zh ? '/screenshots/plugin-settings-zh.jpg' : '/screenshots/plugin-settings-en.jpg'}
        alt={zh ? 'OWiki Sync 插件设置页' : 'OWiki Sync plugin settings'}
        width="2024"
        height="1624"
        loading="lazy"
        className="block w-full"
      />
    </figure>
  )
}

export function QuickStart() {
  const { t } = useLang()

  return (
    <section id="quickstart" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading title={t.quickstart.title} subtitle={t.quickstart.subtitle} />

        <div className="mt-14 space-y-10">
          {t.quickstart.steps.map((step, i) => (
            <div key={step.title} className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div className={cn(i % 2 === 1 && 'lg:order-2')}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand/10 font-mono text-sm font-bold text-brand">
                    {i + 1}
                  </span>
                  <h3 className="text-xl font-semibold">{step.title}</h3>
                </div>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">{step.desc}</p>
              </div>

              {step.tabs ? (
                step.title === t.quickstart.steps[2].title ? (
                  <PluginScreenshot />
                ) : (
                  <CodeTabs tabs={step.tabs} />
                )
              ) : (
                <div className="hidden lg:block" />
              )}
            </div>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-2xl rounded-xl border border-amber/25 bg-amber/5 px-5 py-3.5 text-center text-sm text-amber/90">
          {t.quickstart.note}
        </p>
      </div>
    </section>
  )
}

interface Tab {
  name: string
  lang: string
  code: string
}

function CodeTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(0)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#0d0b16]">
      <div className="flex items-center justify-between border-b border-line px-3 pt-2">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.name}
              onClick={() => setActive(i)}
              className={cn(
                'rounded-t-lg px-4 py-2 text-xs font-medium transition-colors',
                i === active
                  ? 'border-b-2 border-brand bg-surface-2/60 text-ink'
                  : 'text-faint hover:text-muted',
              )}
            >
              {tab.name}
            </button>
          ))}
        </div>
        <CopyButton text={tabs[active].code} />
      </div>
      <CodeBlock code={tabs[active].code} />
    </div>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="mb-1 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-faint transition-colors hover:bg-surface-2 hover:text-muted"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-mint" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'OK' : ''}
    </button>
  )
}

/**
 * 轻量 shell 语法着色：注释 / 字符串 / 命令头 / 参数键。
 * 不引 prism/shiki，控制包体（官网代码块都是我们自己的白名单内容）。
 */
export function CodeBlock({ code }: { code: string }) {
  const lines = code.split('\n')

  const renderLine = (line: string): ReactNode => {
    const trimmed = line.trimStart()
    const indent = line.slice(0, line.length - trimmed.length)

    if (trimmed.startsWith('#')) {
      return (
        <span>
          {indent}
          <span className="text-faint italic">{trimmed}</span>
        </span>
      )
    }

    // docker run / curl 等命令首词高亮
    const parts: ReactNode[] = []
    const regex = /('[^']*'|"[^"]*"|\$\{?\w+\}?|--?[\w-]+|^\s*(?:docker|curl|git|cd|cp|make|node|services|owiki|image|ports|environment|volumes|restart)(?=:|\s|$))/g
    let last = 0
    let m: RegExpExecArray | null
    let key = 0

    while ((m = regex.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index))
      const tok = m[0]
      let cls = 'text-ink'
      if (tok.startsWith("'") || tok.startsWith('"')) cls = 'text-mint'
      else if (tok.startsWith('$')) cls = 'text-amber'
      else if (tok.startsWith('-')) cls = 'text-sky'
      else if (/[:{]/.test(tok)) cls = 'text-ink'
      else cls = 'text-brand-soft font-medium'
      parts.push(
        <span key={key++} className={cls}>
          {tok}
        </span>,
      )
      last = m.index + tok.length
    }
    if (last < line.length) parts.push(line.slice(last))
    return <span>{parts}</span>
  }

  return (
    <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
      <code className="font-mono">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre">
            {line === '' ? ' ' : renderLine(line)}
          </div>
        ))}
      </code>
    </pre>
  )
}
