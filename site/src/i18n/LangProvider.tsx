import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { content, type Content, type Lang } from './content'

const STORAGE_KEY = 'owiki-site-lang'

interface LangCtx {
  lang: Lang
  t: Content
  toggle: () => void
}

const Ctx = createContext<LangCtx | null>(null)

function initialLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang')
  if (fromUrl === 'en' || fromUrl === 'zh') return fromUrl
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'zh') return stored
  return 'zh'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  }, [lang])

  const toggle = () => setLang((l) => (l === 'zh' ? 'en' : 'zh'))

  return <Ctx.Provider value={{ lang, t: content[lang], toggle }}>{children}</Ctx.Provider>
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
