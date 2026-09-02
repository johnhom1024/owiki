import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { content, fill, type Content, type Lang } from './content'

export { fill }

const STORAGE_KEY = 'owiki-web-lang'

interface LangCtx {
  lang: Lang
  t: Content
  setLang: (l: Lang) => void
  toggle: () => void
}

const Ctx = createContext<LangCtx | null>(null)

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    /* ignore */
  }
  // 无历史选择时跟随浏览器语言
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  }, [lang])

  const toggle = () => setLang((l) => (l === 'zh' ? 'en' : 'zh'))

  return (
    <Ctx.Provider value={{ lang, t: content[lang], setLang, toggle }}>{children}</Ctx.Provider>
  )
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
