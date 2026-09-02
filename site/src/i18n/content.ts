export type Lang = 'zh' | 'en'

export const REPO_URL = 'https://github.com/johnhom1024/owiki'

const zh = {
  notice: {
    title: '试验性阶段提醒',
    body: 'OWiki 目前处于早期试验性阶段，同步逻辑尚未经过大规模验证，不当配置或异常场景下可能导致笔记数据丢失或损坏。请在接入前为你的 Obsidian 仓库做好额外备份（建议保留一份独立于同步链路的完整拷贝）。因使用本项目造成的任何数据丢失，概不负责。',
  },
  nav: {
    features: '特性',
    sync: '同步原理',
    architecture: '架构',
    quickstart: '快速开始',
    openapi: 'AI 接口',
    security: '安全',
    faq: 'FAQ',
    source: '源码',
    langToggle: 'EN',
  },
  hero: {
    badge: '开源 · MIT License',
    title1: '你的 Obsidian 笔记库',
    title2: '实时同步 · 完全自持',
    subtitle:
      'OWiki 是自部署的 Obsidian 同步服务 + wiki 功能，实时多端同步，行级三方合并避免冲突，并为 AI 助手敞开你的笔记库。',
    ctaPrimary: '快速开始',
    ctaSecondary: '查看源码',
    chips: ['单二进制 + SQLite', 'WebSocket 实时同步', '增量哈希对账', 'AI 开放 API'],
    demo: {
      title: '同步中',
      mac: 'Mac · Obsidian',
      nas: 'NAS · OWiki 服务端',
      phone: '手机 · Obsidian',
      saved: '保存 2026-08-plan.md',
      reconcile: '哈希对账 · 仅传 1 个变更文件',
      broadcast: 'changed 广播 → 全端秒达',
      merged: '三方合并 · 无冲突',
      syncDone: '已同步',
    },
  },
  features: {
    title: '为什么是 OWiki',
    subtitle: '不订阅、不锁格式、数据不出你的机器',
    items: [
      {
        icon: 'zap',
        title: '增量哈希对账',
        desc: '每个文件取 SHA-256 内容哈希，清单对账找出差异——463 个文件的二次对账秒级完成，只传输真正变化的文件。',
      },
      {
        icon: 'radio',
        title: '多端实时同步',
        desc: '编辑保存 2 秒防抖推送，其他设备通过 changed 广播即时拉取落盘；断线自动指数退避重连，暂存消息补发不丢。',
      },
      {
        icon: 'gitMerge',
        title: '智能冲突合并',
        desc: '写入带 baseHash 乐观锁，能按行三方合并的静默合成；合不了就另存 xxx.conflict.md，本地文件永不被静默覆盖。',
      },
      {
        icon: 'globe',
        title: 'Web 管理端',
        desc: '浏览器直接浏览、搜索、编辑笔记，保存带乐观锁并通过 SSE 实时刷新；设备授权、同步日志时间线一目了然。',
      },
      {
        icon: 'shieldCheck',
        title: '设备级授权',
        desc: '每台设备独立身份，新设备凭 PIN 授权接入，可随时解绑；vault 与设备绑定关系由服务端管理，iCloud 共享库也不串号。',
      },
      {
        icon: 'bot',
        title: 'AI 开放接口',
        desc: '/openapi/* REST 接口让 AI agent 读写笔记库，写入实时广播进 Obsidian——你的 AI 助手从此记得你记过的一切。',
      },
    ],
  },
  architecture: {
    title: '系统架构',
    subtitle: '插件、服务端、消费端，一条链路看清数据流向',
    panelTitle: 'OWiki 架构总览',
  },
  sync: {
    title: '同步是怎么工作的',
    subtitle: '一条 WebSocket 连接，五个消息，零冗余传输',
    steps: [
      {
        step: '01',
        title: '清单对账',
        desc: '客户端扫描 vault 生成 {path, hash, mtime} 清单，服务端逐项比对哈希，返回差异动作列表。mtime 未变的文件直接用本地缓存，不重读内容。',
      },
      {
        step: '02',
        title: '增量传输',
        desc: 'diff 为 upload 的文件读内容上传，download 的按需 fetch 拉取落盘。双端一致时 diffs 为空，零传输。',
      },
      {
        step: '03',
        title: '实时广播',
        desc: '任何一端上传后，服务端向同 vault 其他连接广播 changed，各端校验哈希后自动拉取，应用回环有标志位防护。',
      },
      {
        step: '04',
        title: '冲突合并',
        desc: '并发写入走 baseHash 乐观锁：能行级三方合并的静默合成；合不了的 Web 端三选一处理，插件端另存 conflict 文件。',
      },
    ],
    protoTitle: '消息协议',
    protoNote: '30s 心跳保活 + 读写超时清理死连接；rename / delete 是一等消息，服务端原地改路径并广播。',
    proto: [
      { dir: 'C→S', type: 'hello', desc: '认证 {token, deviceId} → welcome {ok, serverVersion}' },
      { dir: 'C→S', type: 'hashlist', desc: '上报本地清单 → hashlist_response {diffs}' },
      { dir: 'C→S', type: 'upload', desc: '{path, hash, content} → ok + 广播 changed' },
      { dir: 'C→S', type: 'fetch', desc: '{path} → fetch_response {content}' },
      { dir: 'S→C', type: 'changed', desc: '他端上传了 {path, hash} → 按需拉取' },
      { dir: 'S→C', type: 'ping', desc: '30s 心跳，回 pong' },
    ],
  },
  quickstart: {
    title: '三步跑起来',
    subtitle: '一个容器或一个二进制，数据只是一个 SQLite 文件',
    steps: [
      {
        title: '启动服务端',
        desc: 'Docker 一条命令，或下载单二进制直接跑。Web 管理端已内嵌，浏览器打开 http://localhost:8787 即可使用。',
        tabs: [
          {
            name: 'Docker',
            lang: 'bash',
            code: `docker run -d --name owiki \\
  -p 8787:8787 \\
  -e OWIKI_ADDR=':8787' \\
  -e OWIKI_DB=/data/owiki.db \\
  -e OWIKI_TOKEN=<同步令牌> \\
  -e OWIKI_ADMIN_USER=admin \\
  -e OWIKI_ADMIN_PASSWORD=<强密码> \\
  -v ./owiki-data:/data \\
  johnhom1024/owiki:latest
# 国内网络可换镜像源：docker.cnb.cool/johnhom1024/owiki:latest`,
          },
          {
            name: 'docker-compose.yaml',
            lang: 'yaml',
            code: `services:
  owiki:
    image: johnhom1024/owiki:latest
    ports:
      - '8787:8787'
    environment:
      OWIKI_DB: /data/owiki.db
      OWIKI_ADDR: ':8787'
      OWIKI_TOKEN: \${OWIKI_TOKEN}
      OWIKI_ADMIN_USER: admin
      OWIKI_ADMIN_PASSWORD: \${OWIKI_ADMIN_PASSWORD}
    volumes:
      - ./data:/data
    restart: unless-stopped`,
          },
          {
            name: '二进制',
            lang: 'bash',
            code: `git clone https://github.com/johnhom1024/owiki
cd owiki
make run   # :8787，默认 token: dev-token-change-me`,
          },
        ],
      },
      {
        title: '创建 Vault 并授权',
        desc: 'Web 管理端登录后创建 vault，生成同步令牌与设备 PIN；设备列表、同步日志都在同一个设置页里。',
      },
      {
        title: '安装 Obsidian 插件',
        desc: '从 GitHub Release 下载插件三件套放入 vault，启用后填服务器地址与令牌，首次对账自动拉全量。',
        tabs: [
          {
            name: '手动安装',
            lang: 'bash',
            code: `# 下载插件三件套（GitHub Release）
curl -sL -o main.js \\
  https://github.com/johnhom1024/owiki-sync/releases/latest/download/main.js
curl -sL -o manifest.json \\
  https://github.com/johnhom1024/owiki-sync/releases/latest/download/manifest.json
curl -sL -o styles.css \\
  https://github.com/johnhom1024/owiki-sync/releases/latest/download/styles.css

# 拷贝到你的 vault（路径按实际 vault 名调整）
mv main.js manifest.json styles.css \\
  "<你的库>/.obsidian/plugins/owiki-sync/"

# Obsidian → 设置 → 第三方插件 → 启用 owiki-sync
# 填入服务器地址与同步令牌，完成`,
          },
        ],
      },
    ],
    note: '生产环境请务必修改 OWIKI_TOKEN 与管理员密码，并置于反向代理（caddy / nginx）之后启用 TLS。',
  },
  openapi: {
    title: '给 AI 助手一把你笔记库的钥匙',
    subtitle: '/openapi/* REST 接口 · X-API-Key 认证 · 写入实时广播进 Obsidian',
    desc: '在 Web 端生成 API 密钥（SHA-256 存储，明文只显示一次），AI agent 就能新建、读取、更新、删除、搜索笔记——你在 Obsidian 里秒级看到它写下的内容。同步日志会记录每一条 API 写入。OWiki 还提供官方 agent skill 文档，教你的 AI 助手用这套 openapi 完成增删查改。',
    codeTitle: '让 AI 写一篇笔记',
    skillBadge: '官方 Agent Skill：教会任何 AI 助手调用 openapi 增删查改笔记',
    code: `KEY=owk_xxx   # Web 管理端「API 密钥」页生成

# 列出 vault
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults

# 写入笔记 —— Obsidian 端实时收到
curl -s -X POST \\
  "http://localhost:8787/openapi/vaults/1/notes/AI/新文章.md" \\
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \\
  -d '{"content": "# 由 AI 创建\\n\\n来自 agent 的第一条笔记。"}'`,
    points: [
      '笔记新建 / 读取 / 更新 / 删除 / 搜索，全覆盖',
      '官方 agent skill 文档（docs/openapi-skill.md），装进 AI 助手技能目录即学会增删查改',
      '每条写入进入同步日志，来源标记为 openapi',
      '密钥 SHA-256 存储，明文只显示一次，可随时吊销',
    ],
  },
  security: {
    title: '安全与数据归属',
    subtitle: '自托管的意义：数据永远不出你的机器',
    items: [
      {
        icon: 'lock',
        title: '分层认证',
        desc: 'Web 管理端 cookie session（7 天）；/openapi/* 走 X-API-Key；/ws 走 vault 令牌——三套体系互不干扰。',
      },
      {
        icon: 'database',
        title: '明文 SQLite 单文件',
        desc: '所有笔记就是一个 owiki.db，随时备份、迁移、用任意工具读取，不锁任何私有格式。',
      },
      {
        icon: 'eyeOff',
        title: '密钥安全存储',
        desc: 'API 密钥只存 SHA-256 摘要；管理员账户首启初始化，改环境变量不会覆盖已有账户。',
      },
      {
        icon: 'server',
        title: '边界清晰',
        desc: 'MVP 未内置 TLS，建议置于 caddy/nginx 反代之后；除 /api/health 与登录接口外全部需要认证。',
      },
    ],
  },
  faq: {
    title: '常见问题',
    items: [
      {
        q: '和 Obsidian 官方 Sync、iCloud 同步有什么区别？',
        a: '官方 Sync 按月订阅且数据在官方服务器；iCloud 在多平台可靠性和版本控制上有限制。OWiki 数据完全自持——明文 SQLite 文件在你自己的机器上，设备数量没有订阅门槛，还能给 AI 开放读写。',
      },
      {
        q: '同步会不会丢数据？',
        a: '设计上不会静默覆盖：每次写入带 baseHash 乐观锁，能按行三方合并的自动合成，合不了的冲突在 Web 端三选一处理，插件端会另存 xxx.conflict.md。但请注意，OWiki 仍处于试验性阶段，未经大规模验证，极端场景下仍可能丢数据——接入前请务必为 vault 做好额外备份。',
      },
      {
        q: '手机 / 平板能用吗？',
        a: '插件未标记 desktop-only，移动端可安装；服务端在内网或通过内网穿透/TLS 暴露后即可远程同步。建议生产环境置于反向代理之后。',
      },
      {
        q: '同步历史可以追溯吗？',
        a: '可以。服务端记录同步日志：每条文件新增/更新/删除/重命名/合并/冲突与设备上下线，Web 端时间线查看，保留 30 天且单 vault 上限 5000 条，自动清理。',
      },
    ],
  },
  footer: {
    tagline: '自部署的 Obsidian 笔记同步服务',
    links: {
      product: '产品',
      repo: '仓库',
      license: 'MIT License',
    },
    builtWith: 'OWiki 官网 · 由 johnhom 构建',
  },
}

export type Content = typeof zh

const en: Content = {
  notice: {
    title: 'Experimental software',
    body: 'OWiki is in an early experimental stage. The sync logic has not been validated at scale, and improper configuration or edge cases may cause note data loss or corruption. Back up your Obsidian vault before connecting (keep a full copy independent of the sync pipeline). We are not responsible for any data loss caused by using this project.',
  },
  nav: {
    features: 'Features',
    sync: 'How it works',
    architecture: 'Architecture',
    quickstart: 'Quick start',
    openapi: 'AI API',
    security: 'Security',
    faq: 'FAQ',
    source: 'Source',
    langToggle: '中文',
  },
  hero: {
    badge: 'Open source · MIT License',
    title1: 'Your Obsidian vault.',
    title2: 'Synced in real time. Self-hosted.',
    subtitle:
      'OWiki is a self-hosted Obsidian sync service + wiki — realtime multi-device sync, line-level three-way merges to avoid conflicts, and an open door to your vault for AI assistants.',
    ctaPrimary: 'Get started',
    ctaSecondary: 'View source',
    chips: ['Single binary + SQLite', 'Realtime WebSocket', 'Hash reconciliation', 'Open AI API'],
    demo: {
      title: 'Syncing',
      mac: 'Mac · Obsidian',
      nas: 'NAS · OWiki server',
      phone: 'Phone · Obsidian',
      saved: 'Saved 2026-08-plan.md',
      reconcile: 'Reconciled manifests · 1 file changed',
      broadcast: 'changed broadcast → all devices',
      merged: 'Three-way merge · no conflict',
      syncDone: 'In sync',
    },
  },
  features: {
    title: 'Why OWiki',
    subtitle: 'No subscription, no lock-in, no data leaving your machine',
    items: [
      {
        icon: 'zap',
        title: 'Incremental hash reconciliation',
        desc: 'Every file gets a SHA-256 content hash; manifests are diffed server-side. Re-reconciling 463 files takes seconds — only what actually changed gets transferred.',
      },
      {
        icon: 'radio',
        title: 'Realtime multi-device sync',
        desc: 'Saves are pushed after a 2s debounce; other devices pull instantly via changed broadcasts. Automatic exponential-backoff reconnect with queued message replay.',
      },
      {
        icon: 'gitMerge',
        title: 'Smart conflict merging',
        desc: 'Writes carry a baseHash optimistic lock. Clean changes merge silently line-by-line; the rest are saved as xxx.conflict.md — your local file is never silently overwritten.',
      },
      {
        icon: 'globe',
        title: 'Web console',
        desc: 'Browse, search and edit notes in the browser with optimistic-lock saves and SSE live refresh. Device authorization and a sync-log timeline, all in one place.',
      },
      {
        icon: 'shieldCheck',
        title: 'Per-device authorization',
        desc: 'Each device has its own identity, authorized via PIN and revocable anytime. Vault-device bindings live on the server — even iCloud-shared vaults stay isolated.',
      },
      {
        icon: 'bot',
        title: 'Open API for AI',
        desc: '/openapi/* REST endpoints let AI agents read and write your vault, broadcast live into Obsidian — your assistant finally remembers everything you noted.',
      },
    ],
  },
  architecture: {
    title: 'Architecture',
    subtitle: 'Plugin, server, and consumers - one picture of how notes flow',
    panelTitle: 'OWiki architecture overview',
  },
  sync: {
    title: 'How sync works',
    subtitle: 'One WebSocket connection, five messages, zero redundant transfer',
    steps: [
      {
        step: '01',
        title: 'Manifest reconciliation',
        desc: 'The client scans the vault into a {path, hash, mtime} manifest; the server diffs every hash and returns action items. Files with unchanged mtime reuse local cache — no re-reading.',
      },
      {
        step: '02',
        title: 'Incremental transfer',
        desc: 'Files marked upload are read and pushed; download ones are fetched on demand and written to disk. When both sides match, diffs are empty — nothing is transferred.',
      },
      {
        step: '03',
        title: 'Live broadcast',
        desc: 'After any upload, the server broadcasts changed to other connections in the vault; each device pulls after verifying hashes, with a guard flag against echo loops.',
      },
      {
        step: '04',
        title: 'Conflict merging',
        desc: 'Concurrent writes go through the baseHash optimistic lock: mergeable changes merge silently line-by-line; the rest surface as a 3-way choice on the web, or a conflict copy in the plugin.',
      },
    ],
    protoTitle: 'Message protocol',
    protoNote: '30s heartbeat keep-alive + read/write timeouts reap dead connections; rename / delete are first-class messages handled in place and broadcast.',
    proto: [
      { dir: 'C→S', type: 'hello', desc: 'auth {token, deviceId} → welcome {ok, serverVersion}' },
      { dir: 'C→S', type: 'hashlist', desc: 'send local manifest → hashlist_response {diffs}' },
      { dir: 'C→S', type: 'upload', desc: '{path, hash, content} → ok + changed broadcast' },
      { dir: 'C→S', type: 'fetch', desc: '{path} → fetch_response {content}' },
      { dir: 'S→C', type: 'changed', desc: 'peer uploaded {path, hash} → pull on demand' },
      { dir: 'S→C', type: 'ping', desc: '30s heartbeat, reply pong' },
    ],
  },
  quickstart: {
    title: 'Up in three steps',
    subtitle: 'One container or one binary — your data is a single SQLite file',
    steps: [
      {
        title: 'Start the server',
        desc: 'One docker command, or grab the single binary. The web console is embedded — open http://localhost:8787 and you are in.',
        tabs: [
          {
            name: 'Docker',
            lang: 'bash',
            code: `docker run -d --name owiki \\
  -p 8787:8787 \\
  -e OWIKI_ADDR=':8787' \\
  -e OWIKI_DB=/data/owiki.db \\
  -e OWIKI_TOKEN=<sync-token> \\
  -e OWIKI_ADMIN_USER=admin \\
  -e OWIKI_ADMIN_PASSWORD=<strong-password> \\
  -v ./owiki-data:/data \\
  johnhom1024/owiki:latest
# CNB registry mirror for CN networks: docker.cnb.cool/johnhom1024/owiki:latest`,
          },
          {
            name: 'docker-compose.yaml',
            lang: 'yaml',
            code: `services:
  owiki:
    image: johnhom1024/owiki:latest
    ports:
      - '8787:8787'
    environment:
      OWIKI_DB: /data/owiki.db
      OWIKI_ADDR: ':8787'
      OWIKI_TOKEN: \${OWIKI_TOKEN}
      OWIKI_ADMIN_USER: admin
      OWIKI_ADMIN_PASSWORD: \${OWIKI_ADMIN_PASSWORD}
    volumes:
      - ./data:/data
    restart: unless-stopped`,
          },
          {
            name: 'Binary',
            lang: 'bash',
            code: `git clone https://github.com/johnhom1024/owiki
cd owiki
make run   # :8787, default token: dev-token-change-me`,
          },
        ],
      },
      {
        title: 'Create a vault & authorize',
        desc: 'Log into the web console, create a vault, and generate the sync token and device PIN. Devices and sync logs live on the same settings page.',
      },
      {
        title: 'Install the Obsidian plugin',
        desc: 'Download the three plugin files from the GitHub release into your vault, enable it, enter the server URL and token — the first reconciliation pulls everything down.',
        tabs: [
          {
            name: 'Manual install',
            lang: 'bash',
            code: `# Download the three plugin files (GitHub Release)
curl -sL -o main.js \\
  https://github.com/johnhom1024/owiki-sync/releases/latest/download/main.js
curl -sL -o manifest.json \\
  https://github.com/johnhom1024/owiki-sync/releases/latest/download/manifest.json
curl -sL -o styles.css \\
  https://github.com/johnhom1024/owiki-sync/releases/latest/download/styles.css

# Copy into your vault (adjust path to your vault name)
mv main.js manifest.json styles.css \\
  "<your-vault>/.obsidian/plugins/owiki-sync/"

# Obsidian → Settings → Community plugins → enable owiki-sync
# Enter server URL + sync token, done`,
          },
        ],
      },
    ],
    note: 'In production, always change OWIKI_TOKEN and the admin password, and put OWiki behind a reverse proxy (caddy / nginx) for TLS.',
  },
  openapi: {
    title: 'Hand your AI agent the key to your vault',
    subtitle: '/openapi/* REST · X-API-Key auth · writes broadcast live into Obsidian',
    desc: 'Generate an API key in the web console (SHA-256 at rest, shown once in plaintext) and AI agents can create, read, update, delete and search notes — you watch their output land in Obsidian seconds later. Every API write lands in the sync log. OWiki also ships an official agent skill doc that teaches your AI assistant full CRUD over this openapi.',
    codeTitle: 'Let an AI write a note',
    skillBadge: 'Official Agent Skill: teaches any AI assistant CRUD over your notes via openapi',
    code: `KEY=owk_xxx   # generated in the web console "API keys" page

# List vaults
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults

# Write a note — lands in Obsidian instantly
curl -s -X POST \\
  "http://localhost:8787/openapi/vaults/1/notes/AI/new-note.md" \\
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \\
  -d '{"content": "# Written by AI\\n\\nFirst note from an agent."}'`,
    points: [
      'Create / read / update / delete / search notes — full coverage',
      'Official agent skill doc (docs/openapi-skill.md) — drop it into your assistant\u2019s skills dir and it knows CRUD',
      'Every write is recorded in the sync log, tagged source=openapi',
      'Keys stored as SHA-256, plaintext shown once, revocable anytime',
    ],
  },
  security: {
    title: 'Security & data ownership',
    subtitle: 'The point of self-hosting: your data never leaves your machine',
    items: [
      {
        icon: 'lock',
        title: 'Layered auth',
        desc: 'Web console uses cookie sessions (7 days); /openapi/* takes X-API-Key; /ws takes vault tokens — three independent systems.',
      },
      {
        icon: 'database',
        title: 'Plain SQLite, one file',
        desc: 'All notes live in a single owiki.db — back it up, migrate it, read it with any tool. No proprietary formats.',
      },
      {
        icon: 'eyeOff',
        title: 'Safe secret storage',
        desc: 'API keys are stored as SHA-256 digests only; the admin account initializes on first boot and later env changes never overwrite it.',
      },
      {
        icon: 'server',
        title: 'Clear boundaries',
        desc: 'No built-in TLS in the MVP — put it behind caddy/nginx. Everything except /api/health and the login endpoints requires auth.',
      },
    ],
  },
  faq: {
    title: 'FAQ',
    items: [
      {
        q: 'How is this different from Obsidian Sync or iCloud?',
        a: 'Official Sync is a subscription with data on their servers; iCloud has reliability and versioning limits. OWiki keeps data fully yours — a plain SQLite file on your own machine, unlimited devices, and an open API for AI.',
      },
      {
        q: 'Can sync lose my data?',
        a: 'By design, never silently: every write carries a baseHash optimistic lock, mergeable changes merge line-by-line, and conflicts surface as a 3-way choice on the web or a xxx.conflict.md copy in the plugin. That said, OWiki is still experimental and not validated at scale — extreme edge cases may still lose data, so always keep an extra backup of your vault before connecting.',
      },
      {
        q: 'Does it work on mobile?',
        a: 'The plugin is not desktop-only, so mobile Obsidian can install it; expose the server over your LAN or via tunnel/TLS and it syncs remotely. A reverse proxy is recommended in production.',
      },
      {
        q: 'Is sync history traceable?',
        a: 'Yes. The server logs every file create/update/delete/rename/merge/conflict plus device connects — a timeline in the web console, 30-day retention with a 5000-entry per-vault cap, cleaned automatically.',
      },
    ],
  },
  footer: {
    tagline: 'Self-hosted Obsidian sync service',
    links: {
      product: 'Product',
      repo: 'Repository',
      license: 'MIT License',
    },
    builtWith: 'OWiki website · built by johnhom',
  },
}

export const content: Record<Lang, Content> = { zh, en }
