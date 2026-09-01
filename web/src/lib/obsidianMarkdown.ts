/**
 * Obsidian 语法的轻量预处理（浏览器端，无 fs 依赖）：
 *
 * 1. YAML frontmatter                → 解析为属性列表（properties），并从正文剥离。
 * 2. ![[xxx.png]] / ![[xxx.jpg|300]]  → 图片嵌入。
 *    图片附件尚未同步到服务端时渲染成「附件未同步」的占位框。
 * 3. ![[笔记名]] / ![[笔记名#标题]]    → 文本嵌入，暂渲染为指向该笔记的引用块。
 * 4. [[笔记名]] / [[笔记名|别名]] / [[笔记名#标题]] → 普通链接；
 *    解析不到目标时渲染成灰色虚线的「未创建链接」样式（同 Obsidian）。
 * 5. > [!note] Title 等 callout       → 注入隐藏标记 span，
 *    由渲染层（markdownComponents.blockquote）读取后套用彩色外观。
 * 6. #标签                            → 紫色药丸；==文本== → <mark> 高亮。
 *
 * 需要 vaultId 用来构造跳转链接、files 用来按文件名解析目标。
 */

export interface ObsidianProperty {
  key: string
  value: string
}

export interface ObsidianPreprocessResult {
  markdown: string
  /** 本篇笔记引用到、但 vault 里不存在的目标（文件名） */
  unresolved: string[]
  /** YAML frontmatter 解析出的文档属性 */
  properties: ObsidianProperty[]
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

/** 按代码围栏（``` / ~~~）切分，只对非代码段应用替换，避免污染代码块 */
function transformOutsideFences(source: string, fn: (segment: string) => string): string {
  return source
    .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g)
    .map((seg, i) => (i % 2 === 1 ? seg : fn(seg)))
    .join('')
}

/**
 * 极简 YAML frontmatter 解析：支持 `key: value` 扁平键值对和 `- item` 列表
 * （列表折叠为逗号分隔字符串）；嵌套对象/多行字符串等复杂结构不解析。
 */
function parseFrontmatter(source: string): { properties: ObsidianProperty[]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!m) return { properties: [], body: source }
  const properties: ObsidianProperty[] = []
  let lastKey = ''
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const kv = /^([^\s:#][^:#]*?):\s*(.*)$/.exec(line)
    if (kv) {
      lastKey = kv[1].trim()
      const value = kv[2].trim().replace(/^["']|["']$/g, '')
      if (value) properties.push({ key: lastKey, value })
      continue
    }
    // 列表项：并入上一个 key
    const item = /^\s+-\s+(.+)$/.exec(line)
    if (item && lastKey) {
      const existing = properties.find((p) => p.key === lastKey)
      if (existing) existing.value += `, ${item[1].trim()}`
      else properties.push({ key: lastKey, value: item[1].trim() })
    }
  }
  return { properties, body: source.slice(m[0].length) }
}

export function preprocessObsidian(
  source: string,
  vaultId: number,
  files: { id: number; path: string }[],
): ObsidianPreprocessResult {
  const index = buildNameIndex(files)
  const unresolved: string[] = []

  // 0) frontmatter：先剥离，正文不再参与后续替换
  const { properties, body } = parseFrontmatter(source)
  source = body

  // 1) 嵌入：![[target]] 或 ![[target|alias]]
  source = source.replace(/!\[\[([^\][]+?)\]\]/g, (_, raw: string) => {
    const [rawTarget, alias] = splitAlias(raw)
    const target = rawTarget.trim()
    if (!target) return _.toString()

    if (IMAGE_RE.test(target)) {
      // 图片附件：解析到文件 → <img>；解析不到 → 占位框
      const path = resolveAttachmentPath(target, files)
      if (path) {
        const width = alias && /^\d+$/.test(alias.trim()) ? ` width="${alias.trim()}"` : ''
        const alt = (alias && !/^\d+$/.test(alias.trim()) ? alias.trim() : target).replace(/"/g, '&quot;')
        return `<img class="obsidian-embed-image" src="/api/vaults/${vaultId}/attachments/${encodeURI(path)}" alt="${alt}"${width} loading="lazy">`
      }
      unresolved.push(target)
      const alt = (alias && !/^\d+$/.test(alias.trim()) ? alias.trim() : target).replace(/"/g, '&quot;')
      return `<p class="obsidian-embed-placeholder" data-embed-type="image">🖼️ ${escapeHtml(alt)}<span>附件未同步</span></p>`
    }

    // 文本嵌入：指向 vault 里的笔记 → 引用块；找不到 → 占位
    const fileId = resolveTarget(target, index)
    if (fileId !== undefined) {
      return `<blockquote class="obsidian-note-embed">📎 嵌入笔记：<a href="/vaults/${vaultId}/files/${fileId}">${escapeHtml(
        alias?.trim() || target,
      )}</a></blockquote>`
    }
    unresolved.push(target)
    return `<p class="obsidian-embed-placeholder" data-embed-type="note">📄 ${escapeHtml(
      target,
    )}<span>未找到该笔记</span></p>`
  })

  // 2) 普通链接：[[target]] / [[target|alias]] / [[target#heading]]
  source = source.replace(/(?<!!)\[\[([^\][]+?)\]\]/g, (whole, raw: string) => {
    const [rawTarget, alias] = splitAlias(raw)
    const target = rawTarget.trim()
    if (!target) return whole

    // 锚点单独处理：[[#heading]] 指向本文档内的标题
    const hashIdx = target.indexOf('#')
    let base = target
    let anchor = ''
    if (hashIdx >= 0) {
      base = target.slice(0, hashIdx).trim()
      anchor = target.slice(hashIdx) // 保留 #xxx 形式
    }
    if (!base) {
      // 文档内锚点：解析不到标题目标也按普通页内链接处理
      return `[${escapeHtml(alias ?? anchor.slice(1))}](${anchor || '#'})`
    }

    const fileId = resolveTarget(base, index)
    if (fileId === undefined) {
      unresolved.push(base)
      // 未创建的 wikilink：灰字虚线样式（同 Obsidian），保留别名语义
      return `<span class="obsidian-unresolved">${escapeHtml(alias?.trim() || base)}</span>`
    }
    const label = (alias ?? base).trim()
    return `[${escapeHtml(label)}](/vaults/${vaultId}/files/${fileId}${anchor})`
  })

  // 3) callout 标记："> [!type] 可选标题" → 隐藏标记 span，
  //    渲染层的 blockquote 组件读取 data-callout / data-title 套彩色外观。
  //    正文其余部分保持原样 markdown，格式不受影响。
  source = transformOutsideFences(source, (seg) =>
    seg.replace(
      /^([ \t]*>[ \t]?)\[!(\w+)\][+-]?[ \t]*(.*)[ \t]*$/gm,
      (_whole, gt: string, type: string, title: string) =>
        `${gt}<span class="callout-marker" data-callout="${type.toLowerCase()}" data-title="${escapeHtml(
          title.trim(),
        )}"></span>`,
    ),
  )

  // 4) ==高亮== → <mark>
  source = transformOutsideFences(source, (seg) => seg.replace(/==([^=\n]+)==/g, '<mark>$1</mark>'))

  // 5) #标签 → 紫色药丸。要求前面是行首/空白/开括号等；
  //    负向前瞻排除 URL 锚点与 markdown 链接目标里的 (#xxx) / [#xxx]
  source = transformOutsideFences(source, (seg) =>
    seg.replace(
      /(^|[\s>(【\["'])#([A-Za-z_\u4e00-\u9fa5][\w\-/\u4e00-\u9fa5]*)(?![^)\]\s]*[)\]])/g,
      (_whole, pre: string, tag: string) => `${pre}<span class="obsidian-tag">#${tag}</span>`,
    ),
  )

  return { markdown: source, unresolved, properties }
}

/** [[target|alias]] 拆分 */
function splitAlias(raw: string): [string, string | undefined] {
  const idx = raw.indexOf('|')
  if (idx === -1) return [raw, undefined]
  return [raw.slice(0, idx), raw.slice(idx + 1)]
}

/** 文件名 -> FileMeta 的索引（Obsidian wikilink 只写文件名，不含路径） */
function buildNameIndex(files: { id: number; path: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of files) {
    const name = f.path.split('/').pop() ?? f.path
    // 去重：同名文件优先保留先出现的（Obsidian 行为是取最短路径，这里简化）
    if (!m.has(name)) m.set(name, f.id)
    // 无扩展名匹配（[[笔记名]] 不带 .md）：md 文件额外登记去掉后缀的名字
    if (name.toLowerCase().endsWith('.md')) {
      const base = name.slice(0, -3)
      if (!m.has(base)) m.set(base, f.id)
    }
  }
  return m
}

/** 目标解析：支持全名（带扩展）、md 省略扩展、按文件名模糊匹配 */
function resolveTarget(target: string, index: Map<string, number>): number | undefined {
  if (index.has(target)) return index.get(target)
  const lower = target.toLowerCase()
  if (index.has(lower)) return index.get(lower)
  // 带路径的写法 [[dir/note]]：取最后一段再试
  const last = lower.split('/').pop() ?? lower
  return index.get(last)
}

/** 附件路径解析：![[image.png]] 可能不带目录，按文件名匹配出完整路径 */
function resolveAttachmentPath(target: string, files: { path: string }[]): string | undefined {
  if (files.some((f) => f.path === target)) return target
  const hit = files.find((f) => f.path.split('/').pop() === target)
  return hit?.path
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
