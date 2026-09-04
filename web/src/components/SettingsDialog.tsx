import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpCircle,
  BookOpen,
  Code,
  ExternalLink,
  Globe,
  Info,
  Monitor,
  Moon,
  Puzzle,
  Sun,
  X,
} from 'lucide-react'
import { api } from '@/lib/api.ts'
import { useFeatures, type FeatureState } from '@/lib/features.tsx'
import { cn } from '@/lib/utils.ts'
import { useLang } from '@/i18n/LangProvider.tsx'
import type { Lang } from '@/i18n/content.ts'
import { useTheme, type Theme } from '@/hooks/useTheme.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { checkForUpdates, type UpdateCheckResult } from '@/lib/updates.ts'
import { Switch } from '@/components/ui/switch.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Logo } from '@/components/Logo.tsx'

/* ============================================================
   设置弹窗：Obsidian 式左导航 + 右内容
   分区：外观 / 插件 / 关于。关闭后记住上次打开的分区。
   ============================================================ */

type SettingsTab = 'appearance' | 'plugins' | 'about'

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
          type="button"
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

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-sm leading-none">{label}</p>
        {hint && <p className="text-muted-foreground mt-1.5 text-xs leading-snug">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

const REPO_URL = 'https://github.com/johnhom1024/owiki'
const SITE_URL = 'https://johnhom1024.github.io/owiki/'
const DOCS_URL = 'https://github.com/johnhom1024/owiki/blob/main/docs/openapi-skill.md'

function formatVersion(version: string | null, unknown: string): string {
  if (version === null) return '…'
  if (version === '') return unknown
  return version.startsWith('v') ? version : `v${version}`
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const { features, toggle } = useFeatures()
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const [version, setVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateCheckResult['update']>(null)
  const fetched = useRef(false)

  const handleToggle = async (f: FeatureState, enabled: boolean) => {
    try {
      await toggle(f.id, enabled)
    } catch {
      // 失败时 Provider 已重新拉取权威状态
    }
  }

  useEffect(() => {
    if (!open || fetched.current) return
    let cancelled = false
    api
      .health()
      .then(async (h) => {
        if (cancelled) return
        setVersion(h.version ?? '')
        fetched.current = true
        if (h.version) setUpdate((await checkForUpdates(h.version))?.update ?? null)
      })
      .catch(() => {
        if (!cancelled) setVersion('')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const navItems: { id: SettingsTab; label: string; icon: typeof Monitor }[] = [
    { id: 'appearance', label: t.settings.appearance, icon: Monitor },
    { id: 'plugins', label: t.settings.plugins, icon: Puzzle },
    { id: 'about', label: t.settings.about, icon: Info },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(32rem,calc(100vh-4rem))] max-h-[min(32rem,calc(100vh-4rem))] w-[min(44rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{t.settings.title}</DialogTitle>
        <DialogDescription className="sr-only">{t.settings.title}</DialogDescription>

        <div className="flex min-h-0 flex-1">
          {/* ---- 左侧栏：分区导航 ---- */}
          <aside className="bg-sidebar border-sidebar-border flex w-44 shrink-0 flex-col border-r">
            <div className="px-3 pt-4 pb-2">
              <p className="text-muted-foreground px-1.5 text-[11px] font-semibold tracking-wider uppercase">
                {t.settings.title}
              </p>
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                    tab === id
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </nav>
          </aside>

          {/* ---- 右侧内容 ---- */}
          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-5">
              <h2 className="text-sm font-medium">{navItems.find((item) => item.id === tab)?.label}</h2>
              <DialogClose className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md p-1.5 transition-colors">
                <X className="size-4" />
                <span className="sr-only">{t.settings.title}</span>
              </DialogClose>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {tab === 'appearance' && (
                <div className="divide-border divide-y">
                  <SettingRow label={t.settings.theme} hint={t.settings.themeHint}>
                    <Segmented<Theme>
                      value={theme}
                      onChange={setTheme}
                      options={[
                        { value: 'light', label: t.settings.themeLight, icon: <Sun className="size-3.5" /> },
                        { value: 'dark', label: t.settings.themeDark, icon: <Moon className="size-3.5" /> },
                      ]}
                    />
                  </SettingRow>
                  <SettingRow label={t.settings.language} hint={t.settings.languageHint}>
                    <Segmented<Lang>
                      value={lang}
                      onChange={setLang}
                      options={[
                        { value: 'zh', label: t.settings.langZh },
                        { value: 'en', label: t.settings.langEn },
                      ]}
                    />
                  </SettingRow>
                </div>
              )}

              {tab === 'plugins' && (
                <div>
                  {features === null ? (
                    <p className="text-muted-foreground text-sm">{t.settings.pluginsLoading}</p>
                  ) : (
                    <>
                      <div className="divide-border divide-y">
                        {features.map((f) => (
                          <div key={f.id} className="flex items-start justify-between gap-6 py-3">
                            <div className="min-w-0">
                              <p className="text-sm leading-none">{f.name}</p>
                              <p className="text-muted-foreground mt-1.5 text-xs leading-snug">{f.desc}</p>
                            </div>
                            {f.canToggle ? (
                              <Switch
                                checked={f.enabled}
                                onChange={(e) => void handleToggle(f, e.target.checked)}
                              />
                            ) : (
                              <Badge variant="secondary" className="shrink-0">
                                {t.settings.pluginsCore}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-muted-foreground mt-4 text-[11px] leading-snug">
                        {t.settings.pluginsHint}
                      </p>
                    </>
                  )}
                </div>
              )}

              {tab === 'about' && (
                <div className="space-y-6">
                  <div className="flex items-start gap-3.5">
                    <Logo className="size-12" />
                    <div className="min-w-0 pt-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold tracking-tight">OWiki</span>
                        <Badge variant="secondary" className="font-mono tabular-nums">
                          {formatVersion(version, t.settings.versionUnknown)}
                        </Badge>
                        {update && (
                          <a
                            href={update.url}
                            target="_blank"
                            rel="noreferrer"
                            title={update.prerelease ? t.settings.updatePreTooltip : t.settings.updateStableTooltip}
                            className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs font-medium"
                          >
                            <ArrowUpCircle className="size-3.5" />
                            v{update.version}
                            <span className="text-primary/70">{t.settings.updateAvailable}</span>
                          </a>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs leading-snug">
                        {t.settings.aboutTagline}
                      </p>
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
                        className="border-border hover:bg-accent hover:text-accent-foreground text-muted-foreground flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs transition-colors"
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                        <ExternalLink className="size-3 shrink-0 opacity-60" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
