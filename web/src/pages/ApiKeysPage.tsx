import { useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { api, type ApiKeyMeta, type VaultMeta } from '@/lib/api.ts'
import { useLang, fill } from '@/i18n/LangProvider.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card } from '@/components/ui/card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'

/** API 密钥管理：生成给 AI agent 调 /openapi/* 的 key */
export function ApiKeysPage({ vaults }: { vaults: VaultMeta[] | null }) {
  const { t, lang } = useLang()
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('0')
  const [readOnly, setReadOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 新生成的明文 key（只展示一次）
  const [freshKey, setFreshKey] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const res = await api.listApiKeys()
      setKeys(res.data)
    } catch {
      setKeys([])
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  const create = async () => {
    if (!name.trim()) {
      setError(t.common.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.createApiKey({ name: name.trim(), vaultScope: Number(scope), readOnly })
      setCreating(false)
      setName('')
      setReadOnly(false)
      setFreshKey(res.apiKey)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.createFailed)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number, keyName: string) => {
    if (!confirm(fill(t.apiKeys.deleteConfirm, { name: keyName }))) return
    await api.deleteApiKey(id)
    await refresh()
  }

  const scopeLabel = (s: number) =>
    s === 0 ? t.common.allVaults : (vaults?.find((v) => v.id === s)?.name ?? `vault ${s}`)

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <KeyRound className="size-6" /> {t.apiKeys.title}
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t.apiKeys.desc}</p>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus /> {t.apiKeys.create}
        </Button>
      </div>

      {/* 新 key 一次性展示 */}
      {freshKey && (
        <Card className="mb-4 gap-2 border-primary/25 bg-primary/10 py-4 dark:bg-primary/15">
          <div className="px-4 text-sm font-medium">{t.apiKeys.createdNotice}</div>
          <div className="flex items-center gap-2 px-4">
            <code className="flex-1 truncate rounded bg-black/5 px-3 py-2 font-mono text-sm select-all dark:bg-white/10">
              {freshKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(freshKey)
                setFreshKey(null)
              }}
            >
              <Copy /> {t.apiKeys.copyAndClose}
            </Button>
          </div>
        </Card>
      )}

      {keys === null ? (
        <p className="text-muted-foreground py-12 text-center text-sm">{t.common.loading}</p>
      ) : keys.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">{t.apiKeys.empty}</p>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <Badge variant="secondary">{scopeLabel(k.vaultScope)}</Badge>
                    {k.readOnly && <Badge variant="outline">{t.apiKeys.readOnlyBadge}</Badge>}
                  </div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-xs">
                    {k.keyPrefix}…
                    <span className="ml-2">
                      {fill(t.apiKeys.createdAt, { t: new Date(k.createdAt).toLocaleString(locale) })}
                      {k.lastUsedAt
                        ? fill(t.apiKeys.lastUsed, { t: new Date(k.lastUsedAt).toLocaleString(locale) })
                        : ` · ${t.common.neverUsed}`}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" title={t.common.delete} onClick={() => void remove(k.id, k.name)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.apiKeys.dialogTitle}</DialogTitle>
            <DialogDescription>{t.apiKeys.dialogDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">{t.apiKeys.nameLabel}</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.apiKeys.namePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.apiKeys.scopeLabel}</Label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="border-input bg-background focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus:ring-[3px] focus:outline-none"
              >
                <option value="0">{t.common.allVaults}</option>
                {(vaults ?? []).map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t.apiKeys.readOnlyLabel}</span>
                <span className="text-muted-foreground ml-1">{t.apiKeys.readOnlyHint}</span>
              </span>
            </label>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t.common.cancel}
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? t.common.creating : t.common.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
