import { useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { api, type ApiKeyMeta, type VaultMeta } from '@/lib/api.ts'
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
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('0')
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
      setError('名称不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.createApiKey({ name: name.trim(), vaultScope: Number(scope) })
      setCreating(false)
      setName('')
      setFreshKey(res.apiKey)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number, keyName: string) => {
    if (!confirm(`确定删除密钥「${keyName}」？使用它的 AI 工具会立即失效。`)) return
    await api.deleteApiKey(id)
    await refresh()
  }

  const scopeLabel = (s: number) =>
    s === 0 ? '全部 vault' : (vaults?.find((v) => v.id === s)?.name ?? `vault ${s}`)

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <KeyRound className="size-6" /> API 密钥
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            给 AI agent / 外部脚本调用开放接口（/openapi/*）用的密钥
          </p>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus /> 新建密钥
        </Button>
      </div>

      {/* 新 key 一次性展示 */}
      {freshKey && (
        <Card className="mb-4 gap-2 border-primary/25 bg-primary/10 py-4 dark:bg-primary/15">
          <div className="px-4 text-sm font-medium">
            密钥已创建——明文只显示这一次，请立即复制保存：
          </div>
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
              <Copy /> 复制并关闭
            </Button>
          </div>
        </Card>
      )}

      {keys === null ? (
        <p className="text-muted-foreground py-12 text-center text-sm">加载中...</p>
      ) : keys.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          还没有密钥。点「新建密钥」生成一个给 AI 工具用。
        </p>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <Badge variant="secondary">{scopeLabel(k.vaultScope)}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-xs">
                    {k.keyPrefix}…
                    <span className="ml-2">
                      创建于 {new Date(k.createdAt).toLocaleString('zh-CN')}
                      {k.lastUsedAt
                        ? ` · 最近使用 ${new Date(k.lastUsedAt).toLocaleString('zh-CN')}`
                        : ' · 未使用过'}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" title="删除" onClick={() => void remove(k.id, k.name)}>
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
            <DialogTitle>新建 API 密钥</DialogTitle>
            <DialogDescription>
              密钥明文只在创建后显示一次。AI 工具通过请求头 X-API-Key 或 Authorization:
              Bearer 携带。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">名称</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：claude-agent、n8n-workflow"
              />
            </div>
            <div className="space-y-2">
              <Label>可访问范围</Label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="border-input bg-background focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus:ring-[3px] focus:outline-none"
              >
                <option value="0">全部 vault</option>
                {(vaults ?? []).map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
