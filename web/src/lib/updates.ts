/* ============================================================
   版本更新检测：浏览器直查 GitHub Releases API
   - 一次请求 /releases?per_page=20，同时得出最新正式版与最新预发布
   - beta 判定走 semver 全序（0.0.3-beta.1 < 0.0.3 < 0.0.4-beta.1）
   - 结果缓存 localStorage（24h TTL，随当前版本变化失效）
   - 失败 / 超时 / 版本不可解析（dev）一律静默返回 null
   ============================================================ */

const GITHUB_API = 'https://api.github.com/repos/johnhom1024/owiki'
const CACHE_KEY = 'owiki-update-check'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
/** 一次拉多少条 release（够覆盖几十个 beta 的节奏） */
const LIST_PER_PAGE = 20

export interface UpdateInfo {
  /** 纯数字版本号（无 v 前缀） */
  version: string
  prerelease: boolean
  /** GitHub Release 页链接 */
  url: string
  /** 更新说明（markdown，来自 release body） */
  notes: string
  publishedAt: string
}

export interface UpdateCheckResult {
  /** 当前版本（无 v 前缀） */
  current: string
  /** 当前版本所在通道 */
  channel: 'stable' | 'pre'
  latestStable: UpdateInfo | null
  latestPre: UpdateInfo | null
  /** 按通道规则需要提示的更新；null = 已是最新 */
  update: UpdateInfo | null
  checkedAt: number
}

/* ---------- semver（仅本项目用到的子集：主版本 + 预发布段） ---------- */

interface Parsed {
  major: number
  minor: number
  patch: number
  pre: string[]
}

function parseVersion(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(v.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] }
}

/** semver 全序比较，-1 / 0 / 1；任一侧无法解析返回 null */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  // 无预发布段 > 有（0.0.3 > 0.0.3-beta.1）
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    if (pa.pre.length === pb.pre.length) return 0
    return pa.pre.length === 0 ? 1 : -1
  }
  const n = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1 // 字段少的一方更小（beta.1 < beta.1.2）
    if (y === undefined) return 1
    if (x === y) continue
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1
    if (nx) return -1 // 数字标识符 < 字母标识符
    if (ny) return 1
    return x < y ? -1 : 1
  }
  return 0
}

/* ---------- GitHub API ---------- */

interface ReleasePayload {
  tag_name: string
  html_url: string
  prerelease: boolean
  draft: boolean
  published_at: string
  body: string | null
}

async function ghFetch(path: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function toInfo(r: ReleasePayload): UpdateInfo | null {
  const version = r.tag_name.replace(/^v/, '')
  if (!parseVersion(version)) return null
  return {
    version,
    prerelease: r.prerelease,
    url: r.html_url,
    notes: r.body ?? '',
    publishedAt: r.published_at,
  }
}

function pickLatest(list: UpdateInfo[]): UpdateInfo | null {
  let best: UpdateInfo | null = null
  for (const item of list) {
    if (!best || (compareVersions(item.version, best.version) ?? 0) > 0) best = item
  }
  return best
}

/* ---------- 缓存 ---------- */

function readCache(current: string): UpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as UpdateCheckResult
    if (c.current !== current) return null
    if (Date.now() - c.checkedAt >= CACHE_TTL_MS) return null
    return c
  } catch {
    return null
  }
}

function writeCache(result: UpdateCheckResult) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result))
  } catch {
    /* 隐私模式等场景写不进就算了 */
  }
}

/* ---------- 主入口 ---------- */

/**
 * 检查更新。currentVersion 为 /api/health 的 version（如 "0.0.3-beta.1"）。
 * 任何失败都返回 null（调用方静默降级，不打扰现有版本展示）。
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult | null> {
  const current = currentVersion.replace(/^v/, '')
  const cur = parseVersion(current)
  if (!current || current === 'dev' || !cur) return null

  const cached = readCache(current)
  if (cached) return cached

  let payload: unknown
  try {
    payload = await ghFetch(`/releases?per_page=${LIST_PER_PAGE}`)
  } catch {
    return null // 网络不通 / 限额 / 超时：静默
  }
  if (!Array.isArray(payload)) return null

  const stables: UpdateInfo[] = []
  const pres: UpdateInfo[] = []
  for (const r of payload) {
    if (typeof r !== 'object' || r === null) continue
    const rel = r as ReleasePayload
    if (rel.draft || !rel.tag_name) continue
    const info = toInfo(rel)
    if (!info) continue
    ;(rel.prerelease ? pres : stables).push(info)
  }

  const latestStable = pickLatest(stables)
  const latestPre = pickLatest(pres)
  const gt = (a: UpdateInfo | null) => (a ? (compareVersions(a.version, current) ?? 0) > 0 : false)

  // 通道规则：
  // - 正式版用户只看正式版更新（默认不推 beta）
  // - beta 用户看「更新的 beta」和「已发布的正式版」中更高的那个
  let update: UpdateInfo | null = null
  if (cur.pre.length > 0) {
    const stableUp = gt(latestStable) ? latestStable : null
    const preUp = gt(latestPre) ? latestPre : null
    update =
      stableUp && preUp
        ? (compareVersions(stableUp.version, preUp.version) ?? 0) >= 0
          ? stableUp
          : preUp
        : (stableUp ?? preUp)
  } else {
    update = gt(latestStable) ? latestStable : null
  }

  const result: UpdateCheckResult = {
    current,
    channel: cur.pre.length > 0 ? 'pre' : 'stable',
    latestStable,
    latestPre,
    update,
    checkedAt: Date.now(),
  }
  writeCache(result)
  return result
}
