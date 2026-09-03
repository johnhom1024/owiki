import { useEffect, useRef } from 'react'
import type { VaultMeta } from '@/lib/api.ts'

/** 同步进度事件（服务端 SSE 推送） */
export interface SyncProgressEvent {
  vaultId: number
  total: number
  done: number
}

/**
 * 订阅服务端 SSE 事件流（/api/events）：vault 授权/取消授权/解绑/同步进度时自动重查。
 * Web 端打开后挂一次，断网/重连浏览器由 EventSource 自身处理。
 *
 * 注意：刷新时尽量复用现有 vaults 数组的元素（id/name/clients/files/size 保留），
 * 只更新授权相关字段（authorized/lastSeenAt），避免侧边栏闪烁。
 */
export interface NoteSyncedEvent {
  vaultId: number
  path: string
}

export function useVaultEvents(
  vaults: VaultMeta[] | null,
  setVaults: (v: VaultMeta[]) => void,
  onChange: () => void,
  onProgress?: (ev: SyncProgressEvent) => void,
  onSyncDone?: (vaultId: number) => void,
  onLog?: (vaultId: number) => void,
  onNoteSynced?: (ev: NoteSyncedEvent) => void,
): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onSyncDoneRef = useRef(onSyncDone)
  onSyncDoneRef.current = onSyncDone
  const onLogRef = useRef(onLog)
  onLogRef.current = onLog
  const onNoteSyncedRef = useRef(onNoteSynced)
  onNoteSyncedRef.current = onNoteSynced

  const vaultsRef = useRef(vaults)
  vaultsRef.current = vaults

  useEffect(() => {
    const es = new EventSource('/api/events')

    es.addEventListener('vault', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as {
          type: string
          vaultId: number
          total?: number
          done?: number
          path?: string
        }
        if (ev.type === 'vault.authorized') {
          // 单台设备认证成功（含首次+每次重连）-> 列表 authorized=true
          if (vaultsRef.current) {
            setVaults(
              vaultsRef.current.map((v) =>
                v.id === ev.vaultId ? { ...v, authorized: true } : v,
              ),
            )
          }
          onChangeRef.current()
        } else if (ev.type === 'vault.unauthorized') {
          // 全部设备被解绑/取消授权 -> 列表 authorized=false
          if (vaultsRef.current) {
            setVaults(
              vaultsRef.current.map((v) =>
                v.id === ev.vaultId ? { ...v, authorized: false } : v,
              ),
            )
          }
          onChangeRef.current()
        } else if (ev.type === 'vault.progress') {
          // 同步进度：交给上层更新进度条，不触发列表重查
          onProgressRef.current?.({
            vaultId: ev.vaultId,
            total: ev.total ?? 0,
            done: ev.done ?? 0,
          })
        } else if (ev.type === 'vault.sync_done') {
          // 一轮同步完成（全部文件已落库）：通知上层刷新文件树
          onSyncDoneRef.current?.(ev.vaultId)
        } else if (ev.type === 'vault.log') {
          // 新同步日志产生：交给上层通知日志组件刷新（不重查 vault 列表）
          onLogRef.current?.(ev.vaultId)
        } else if (ev.type === 'note.synced') {
          // 某客户端 fetch 完成 = 这篇笔记的改动已送达（Web 保存→插件拉取的回执）
          if (typeof ev.path === 'string') {
            onNoteSyncedRef.current?.({ vaultId: ev.vaultId, path: ev.path })
          }
        } else {
          // 其他（unbound 等）：触发设置页重查即可
          onChangeRef.current()
        }
      } catch {
        // 解析失败不影响主流程
      }
    })

    return () => es.close()
  }, [setVaults])
}
