import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CheckCircle2 } from 'lucide-react'
import { api, type VaultMeta } from '@/lib/api.ts'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function HomePage({
  vaults,
  onRefresh,
}: {
  vaults: VaultMeta[] | null
  onRefresh: () => Promise<void>
}) {
  void api // 预留：首页后续可加全局统计
  void onRefresh

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-bold">Vaults</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        每一个 vault 是一个独立的同步库，对应一个 Obsidian vault。点击进入查看笔记。
      </p>

      {vaults === null && <p className="text-muted-foreground py-20 text-center">加载中...</p>}

      {vaults?.length === 0 && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-20 text-center">
          还没有 vault。点击左侧栏的 + 创建一个。
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {vaults?.map((v) => (
          <Link key={v.id} to={`/vaults/${v.id}`}>
            <Card className="hover:border-primary/40 hover:shadow-md transition-all">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="size-4 opacity-70" />
                  {v.name}
                </CardTitle>
                <CardDescription>{v.note || '—'}</CardDescription>
                <CardAction>
                  {v.clients > 0 ? (
                    <Badge className="bg-primary">{v.clients} 在线</Badge>
                  ) : v.authorized ? (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="size-3 text-primary" /> 已授权
                    </Badge>
                  ) : (
                    <Badge variant="outline">未授权</Badge>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {v.files} 个文件 · {formatSize(v.size)}
                </span>
                <Button variant="ghost" size="sm">
                  进入 <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
