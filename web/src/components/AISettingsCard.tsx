import { useState } from 'react'
import { Bot, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useLang } from '@/i18n/LangProvider'
import { useAI } from '@/lib/ai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * 设置弹窗「插件」分区内联的 AI 对话配置卡。
 * 出现在 chat feature 开关下方；三字段 + 测试连接。
 * ready = enabled && 三项齐全 && 测通 —— 驱动右侧对话入口显隐。
 */
export function AISettingsCard() {
  const { t } = useLang()
  const { status, refresh } = useAI()
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [initialized, setInitialized] = useState(false)

  // 服务端状态回填表单（一次性；用户编辑后不再覆盖）
  if (!initialized && status) {
    setBaseUrl(status.baseUrl)
    setModel(status.model)
    setInitialized(true)
  }

  const dirty =
    status == null ||
    baseUrl !== status.baseUrl ||
    model !== status.model ||
    apiKey !== ''

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ enabled: true, baseUrl, apiKey, model }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      setApiKey('')
      await refresh()
      setTestResult(null)
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/chat/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ baseUrl, apiKey, model }),
      })
      const b = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; model?: string }
      setTestResult({ ok: !!b.ok, msg: b.ok ? `${b.model} ✓` : b.error ?? 'failed' })
      await refresh()
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-3.5">
      <div className="flex items-center gap-2 text-sm">
        <Bot className="size-4 text-primary" />
        {t.chat.settingsTitle}
      </div>
      <p className="text-muted-foreground mt-1 text-xs leading-snug">{t.chat.settingsHint}</p>

      <div className="mt-3 space-y-2.5">
        <div className="space-y-1">
          <Label className="text-xs">Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">API Key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.apiKeySet ? t.chat.keyKeepHint : 'sk-...'}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
            className="h-8 font-mono text-xs"
          />
        </div>
      </div>

      {status?.lastTestErr && !testResult && (
        <p className="mt-2 text-xs text-destructive">{status.lastTestErr}</p>
      )}
      {testResult && (
        <p
          className={cn(
            'mt-2 flex items-start gap-1.5 text-xs',
            testResult.ok ? 'text-emerald-500' : 'text-destructive',
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="break-all">{testResult.msg}</span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-muted-foreground text-[11px]">
          {status?.ready ? t.chat.readyHint : t.chat.notReadyHint}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void test()} disabled={testing || !baseUrl || !model}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t.chat.testBtn}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !dirty || !baseUrl || !model}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t.common.save}
          </Button>
        </div>
      </div>
    </div>
  )
}
