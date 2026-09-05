export interface FileMeta {
  id: number
  vaultId: number
  path: string
  contentHash: string
  mtime: number
  size: number
  updatedAt: string
}

export interface FileDetail extends FileMeta {
  content: string
}

export interface Stats {
  totalFiles: number
  totalSize: number
}

export interface Health {
  status: string
  clients: number
  /** 服务端版本（ldflags 注入，本地 dev 为 "dev"） */
  version?: string
}

export interface VaultMeta {
  id: number
  name: string
  note: string
  createdAt: string
  updatedAt: string
  /** 是否有过至少一次成功的 Obsidian 授权（WS 认证成功即算） */
  authorized: boolean
  /** 最近一次认证时间（空串 = 从未） */
  lastSeenAt: string
  files: number
  size: number
  clients: number
}

export interface VaultDetail {
  id: number
  name: string
  note: string
  createdAt: string
  updatedAt: string
  /** 单设备同步模式：只有 pinnedDeviceId 对应设备能与本 vault 同步 */
  singleDevice?: boolean
  pinnedDeviceId?: string
}

export interface VaultSummary {
  data: VaultDetail
  stats: Stats
  clients: number
  authorized: boolean
  lastSeenAt: string
}

export interface VaultTokenInfo {
  token: string
  serverUrl: string
  obsidianOAuth: string
}

export interface VaultDevice {
  id: number
  vaultId: number
  deviceId: string
  deviceName: string
  /** 客户端插件版本（来自 hello.clientVersion），老客户端未带时为空串 */
  clientVersion: string
  lastSeenAt: string
  createdAt: string
}

/** 同步日志条目（服务端 sync_logs 表） */
export interface SyncLogEntry {
  id: number
  vaultId: number
  /** 动作类型：file.create / file.update / file.delete / file.rename / file.merge / file.conflict / file.echo / device.connect / device.unbind */
  action: string
  /** 文件路径；rename 时为「旧路径 → 新路径」 */
  path: string
  /** 补充信息（合并提示、来源说明等） */
  detail: string
  /** 变更内容字节数 */
  size: number
  /** 来源：ws（插件）/ web（网页编辑）/ openapi（开放 API） */
  source: string
  deviceId: string
  deviceName: string
  createdAt: string
}

/** 日志过滤类型（服务端按动作集合过滤） */
export type SyncLogFilter = '' | 'changes' | 'deletes' | 'conflicts'

export class ConflictError extends Error {
  serverContent: string
  serverHash: string
  mergedHint: string
  constructor(body: { serverContent: string; serverHash: string; mergedHint?: string }) {
    super('conflict')
    this.serverContent = body.serverContent
    this.serverHash = body.serverHash
    this.mergedHint = body.mergedHint ?? ''
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    // 通知 App 级监听器：session 过期 → 全局跳登录页
    window.dispatchEvent(new CustomEvent('owiki-unauthorized'))
  }
}

export class RateLimitError extends Error {
  retryAfter: number
  constructor(retryAfter: number) {
    super('rate limited')
    this.retryAfter = retryAfter
  }
}

/** 文章分享状态（详情页分享浮窗数据源） */
export interface ShareInfo {
  enabled: boolean
  token: string
  createdAt?: string
}

/** 公开分享页的只读文件数据（与 FileDetail 同构） */
export interface SharedFileDetail {
  id: number
  vaultId: number
  path: string
  content: string
  contentHash: string
  mtime: number
  size: number
  updatedAt: string
}

/** Git 远程备份配置（vault 级；token 服务端回掩码） */
export interface GitBackupConfig {
  vaultId: number
  remoteUrl: string
  branch: string
  /** 掩码或空串；PUT 时传明文写入，留空 = 保持不变 */
  token: string
  debounceSec: number
  enabled: boolean
  lastCommitSha: string
  lastPushAt: string | null
  lastRunAt: string | null
  lastError: string
  status: string
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new UnauthorizedError()
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.status === 429) {
    throw new RateLimitError(Number(data.retryAfter ?? 60))
  }
  if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`))
  return data as T
}

export interface ApiKeyMeta {
  id: number
  name: string
  keyPrefix: string
  vaultScope: number
  readOnly: boolean
  createdAt: string
  lastUsedAt: string | null
}

export const api = {
  health: () => get<Health>('/api/health'),
  stats: () => get<Stats>('/api/stats'),

  // ---------- 登录 ----------
  authStatus: () => get<{ initialized: boolean }>('/api/auth/status'),
  /** 第一步：密码。启用 TOTP 时返回 { needTotp: true, totpTicket } */
  login: (body: { username: string; password: string }) =>
    send<{ ok?: boolean; needTotp?: boolean; totpTicket?: string }>(
      '/api/auth/login',
      'POST',
      body,
    ),
  /** 第二步：票据 + 6 位验证码换 session */
  loginTotp: (body: { totpTicket: string; code: string }) =>
    send<{ ok: boolean }>('/api/auth/totp', 'POST', body),
  logout: () => send<{ ok: boolean }>('/api/auth/logout', 'POST'),

  // ---------- TOTP 二次认证管理（需登录） ----------
  totpStatus: () => get<{ enabled: boolean; pending: boolean }>('/api/auth/totp'),
  totpSetup: () => send<{ secret: string; otpauthUrl: string }>('/api/auth/totp/setup', 'POST'),
  totpConfirm: (body: { code: string }) =>
    send<{ ok: boolean }>('/api/auth/totp/confirm', 'POST', body),
  totpDisable: (body: { password: string }) =>
    send<{ ok: boolean }>('/api/auth/totp/disable', 'POST', body),

  // ---------- API 密钥（开放接口） ----------
  listApiKeys: () => get<{ data: ApiKeyMeta[] }>('/api/apikeys'),
  createApiKey: (body: { name: string; vaultScope?: number; readOnly?: boolean }) =>
    send<{ data: ApiKeyMeta; apiKey: string }>('/api/apikeys', 'POST', body),
  deleteApiKey: (id: number) => send<{ ok: boolean }>(`/api/apikeys/${id}`, 'DELETE'),

  // ---------- vault ----------
  listVaults: () => get<{ data: VaultMeta[]; total: number }>('/api/vaults'),
  getVault: (vid: number) => get<VaultSummary>(`/api/vaults/${vid}`),
  createVault: (body: { name: string; note?: string }) =>
    send<{ data: VaultDetail }>('/api/vaults', 'POST', body),
  updateVault: (vid: number, body: { name?: string; note?: string }) =>
    send<{ data: VaultDetail }>(`/api/vaults/${vid}`, 'PUT', body),
  /** 单设备同步设置：开启必须带 pinnedDeviceId，关闭时传 singleDevice:false */
  setSingleDevice: (
    vid: number,
    body: { singleDevice: boolean; pinnedDeviceId?: string },
  ) => send<{ data: VaultDetail }>(`/api/vaults/${vid}/single-device`, 'PUT', body),
  deleteVault: (vid: number) => send<{ ok: boolean }>(`/api/vaults/${vid}`, 'DELETE'),
  getVaultToken: (vid: number) => get<VaultTokenInfo>(`/api/vaults/${vid}/token`),
  rotateVaultToken: (vid: number) =>
    get<VaultTokenInfo>(`/api/vaults/${vid}/token/rotate`),
  revokeVault: (vid: number) =>
    fetch(`/api/vaults/${vid}/revoke`, { method: 'POST' }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<{ ok: boolean }>
    }),
  listVaultDevices: (vid: number) =>
    get<{ data: VaultDevice[] }>(`/api/vaults/${vid}/devices`),
  /** 同步日志：游标分页（新→旧）。before 为上一页最旧一条 id，0 表示第一页 */
  listVaultLogs: (
    vid: number,
    opts: { before?: number; limit?: number; type?: SyncLogFilter } = {},
  ) => {
    const q = new URLSearchParams()
    if (opts.before) q.set('before', String(opts.before))
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.type) q.set('type', opts.type)
    const qs = q.toString()
    return get<{ data: SyncLogEntry[]; hasMore: boolean }>(
      `/api/vaults/${vid}/logs${qs ? `?${qs}` : ''}`,
    )
  },

  // ---------- vault 作用域的文件 ----------
  listVaultFiles: (vid: number) =>
    get<{ data: FileMeta[]; total: number }>(`/api/vaults/${vid}/files`),
  /** Web 端在指定 vault 新建笔记；路径已存在返回 409 */
  createVaultFile: (vid: number, body: { path: string; content?: string }) =>
    send<{ data: FileDetail }>(`/api/vaults/${vid}/files`, 'POST', body),
  getVaultStats: (vid: number) => get<Stats>(`/api/vaults/${vid}/stats`),
  /** 按路径解析文件元数据（首页「最近动态」跳转详情用） */
  resolveVaultFile: (vid: number, path: string) =>
    get<{ data: FileMeta }>(`/api/vaults/${vid}/resolve?path=${encodeURIComponent(path)}`),

  // ---------- Git 远程备份（vault 级） ----------
  getGitBackup: (vid: number) => get<{ data: GitBackupConfig }>(`/api/vaults/${vid}/git-backup`),
  /** 保存配置；token 留空 = 保持不变（服务端不回明文） */
  setGitBackup: (
    vid: number,
    body: {
      remoteUrl?: string
      branch?: string
      token?: string
      debounceSec?: number
      enabled?: boolean
    },
  ) => send<{ data: GitBackupConfig }>(`/api/vaults/${vid}/git-backup`, 'PUT', body),
  /** 立即备份一轮（跳过防抖） */
  runGitBackup: (vid: number) => send<{ ok: boolean }>(`/api/vaults/${vid}/git-backup/run`, 'POST'),

  // ---------- 文件读写（跨 vault 的旧接口，按 id） ----------
  listFiles: () => get<{ data: FileMeta[]; total: number }>('/api/files'),
  getFile: (id: number) => get<FileDetail>(`/api/files/${id}`),
  saveFile: async (
    id: number,
    body: { content: string; baseHash: string; force?: boolean },
  ) => {
    const res = await fetch(`/api/files/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as Record<string, unknown>
    if (res.status === 409) {
      throw new ConflictError({
        serverContent: String(data.serverContent ?? ''),
        serverHash: String(data.serverHash ?? ''),
        mergedHint: String(data.mergedHint ?? ''),
      })
    }
    if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`))
    return data as { data: FileDetail; merged: boolean }
  },

  // ---------- 文章分享 ----------
  /** 当前笔记的分享状态（无记录时服务端会建一条 disabled 的并返回 token） */
  getShare: (id: number) => get<ShareInfo>(`/api/files/${id}/share`),
  /** 开/关分享 */
  setShare: (id: number, enabled: boolean) =>
    send<ShareInfo>(`/api/files/${id}/share`, 'PUT', { enabled }),
  /** 公开分享页数据（免登录；404 = 分享不存在或已关闭） */
  getSharedFile: async (token: string): Promise<SharedFileDetail> => {
    const res = await fetch(`/api/share/${token}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as SharedFileDetail
  },
}
