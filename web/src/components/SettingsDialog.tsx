import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Code, ExternalLink, Globe, Info, Monitor, Moon, Sun } from 'lucide-react'
import { api } from '@/lib/api.ts'
import { cn } from '@/lib/utils.ts'
import { useLang } from '@/i18n/LangProvider.tsx'
import type { Lang } from '@/i18n/content.ts'
import { useTheme, type Theme } from '@/hooks/useTheme.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Separator } from '@/components/ui/separator.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Logo } from '@/components/Logo.tsx'

/* ============================================================
   设置弹窗：外观（主题/语言分段控件） + 关于（版本徽章 + 链接）
   ============================================================ */

/** 分段控件：一组选项中单选 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="bg-muted inline-flex rounded-md p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors',
            opt.value === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 设置行：左标签 + 右控件 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  )
}

const REPO_URL = 'https://github.com/johnhom1024/owiki'
const SITE_URL = 'https://johnhom1024.github.io/owiki/'
const DOCS_URL = 'https://github.com/johnhom1024/owiki/blob/main/docs/openapi-skill.md'

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const [version, setVersion] = useState<string | null>(null)
  const fetched = useRef(false)

  // 打开时拉一次服务端版本（/api/health 公开端点）。成功后缓存，失败下次打开重试。
  useEffect(() => {
    if (!open || fetched.current) return
    let cancelled = false
    api
      .health()
      .then((h) => {
        if (cancelled) return
        setVersion(h.version ?? '')
        fetched.current = true
      })
      .catch(() => {
        if (!cancelled) setVersion('')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.settings.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.settings.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ---- 外观 ---- */}
          <section className="space-y-3">
            <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <Monitor className="size-3.5" />
              {t.settings.appearance}
            </h3>
            <Row label={t.settings.theme}>
              <Segmented<Theme>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', label: t.settings.themeLight, icon: <Sun className="size-3.5" /> },
                  { value: 'dark', label: t.settings.themeDark, icon: <Moon className="size-3.5" /> },
                ]}
              />
            </Row>
            <Row label={t.settings.language}>
              <Segmented<Lang>
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'zh', label: t.settings.langZh },
                  { value: 'en', label: t.settings.langEn },
                ]}
              />
            </Row>
          </section>

          <Separator />

          {/* ---- 关于 ---- */}
          <section className="space-y-3">
            <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <Info className="size-3.5" />
              {t.settings.about}
            </h3>
            <div className="flex items-center gap-3">
              <Logo className="size-10" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">OWiki</span>
                  <Badge variant="secondary" className="font-mono tabular-nums">
                    {version === null
                      ? '…'
                      : version === ''
                        ? t.settings.versionUnknown
                        : version.startsWith('v')
                          ? version
                          : `v${version}`}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { href: SITE_URL, label: t.settings.website, icon: Globe },
                { href: DOCS_URL, label: t.settings.docs, icon: BookOpen },
                { href: REPO_URL, label: t.settings.source, icon: Code },
              ].map(({ href, label, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="border hover:bg-accent hover:text-accent-foreground text-muted-foreground flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                  <ExternalLink className="size-3 shrink-0 opacity-60" />
                </a>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
