export type Lang = 'zh' | 'en'

export const REPO_URL = 'https://github.com/johnhom1024/owiki'
/** GitHub raw：浏览器按 text/plain 直接展示 skill 原文 */
export const SKILL_RAW_URL =
  'https://raw.githubusercontent.com/johnhom1024/owiki/main/docs/openapi-skill.md'

const zh = {
  notice: {
    title: '试验性阶段提醒',
    body: 'OWiki 目前处于早期试验性阶段，同步逻辑尚未经过大规模验证，极端场景下可能导致笔记数据丢失或损坏。请在接入前为你的 Obsidian 仓库做好额外备份（建议保留一份独立于同步链路的完整拷贝）。因使用本项目造成的任何数据丢失，概不负责。',
  },
  nav: {
    wiki: 'Wiki',
    features: '特性',
    sync: '同步原理',
    architecture: '架构',
    quickstart: '快速开始',
    openapi: 'AI 接口',
    security: '安全',
    faq: 'FAQ',
    skill: 'Skill',
    source: '源码',
    langToggle: 'EN',
    themeToggle: 'Switch theme',
  },
  hero: {
    badge: '开源 · MIT License',
    title1: '把 Obsidian 笔记库',
    title2: '变成你的 Wiki 网站',
    subtitle:
      '库还是那个库。打开网址就能浏览、搜索、编辑，像读网站一样读自己的笔记——同步、分享、AI 都在同一台机器上。',
    ctaPrimary: '快速开始',
    ctaSecondary: '查看源码',
    chips: ['Obsidian 变 Wiki 网站', '多端实时同步', '冲突不丢内容', 'AI 开放接口'],
    demo: {
      title: '同步中',
      mac: 'Mac · Obsidian',
      nas: 'NAS · OWiki 服务端',
      phone: '手机 · Obsidian',
      saved: '保存 2026-08-plan.md',
      reconcile: '对账完成 · 只有 1 个文件有变化',
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
        title: '只传变化的文件',
        desc: '没改过的笔记一个字节都不走。几百个文件的库重新对一遍只要几秒，设备间一致时零流量。',
      },
      {
        icon: 'radio',
        title: '多端实时同步',
        desc: '一台设备上保存，其他设备 2 秒内收到；编辑、重命名、删除都会跟着同步。断网也不怕，改动先存在本地，连上自动补传。',
      },
      {
        icon: 'gitMerge',
        title: '冲突不丢内容',
        desc: '两台设备同时改一篇笔记，能自动合并的自动合并，合不了的另存 xxx.conflict.md 副本——本地文件永不被静默覆盖。',
      },
      {
        icon: 'bookOpen',
        title: 'Obsidian 变 Wiki 网站',
        desc: '笔记库同步上来，浏览器打开就是你的个人 Wiki：目录、搜索、阅读、编辑都在网页上，不用装 Obsidian。',
      },
      {
        icon: 'globe',
        title: '任何设备打开就能用',
        desc: '手机、公司电脑、平板，打开网址就能进自己的 Wiki。设备授权、同步日志也都在网页上。',
      },
      {
        icon: 'shieldCheck',
        title: '设备级授权',
        desc: '每台设备独立身份，新设备凭 PIN 授权接入，不想要了随时解绑。共用 iCloud 库也不会串号。',
      },
      {
        icon: 'bot',
        title: 'AI 开放接口',
        desc: '给 AI 助手发一把钥匙，它就能读你的笔记、帮你写——它写下的内容秒级出现在 Obsidian 里。',
      },
      {
        icon: 'share2',
        title: '笔记分享',
        desc: '任意笔记开个开关就有公开只读链接，发给朋友扫码即读；不想分享了关掉，链接立即失效。',
      },
      {
        icon: 'puzzle',
        title: '功能可开关',
        desc: '设置里像 Obsidian 一样拨插件：文章分享、同步日志、AI 接口、MCP。关掉立刻从界面消失，已发出的链接立刻失效；数据还在，重开就回来。',
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
  johnhom1024/owiki:latest`,
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
        desc: '已上架 Obsidian 社区插件市场：设置 → 第三方插件 → 浏览，搜索 owiki-sync 安装，填服务器地址与令牌，首次连接自动拉全量。',
        tabs: [
          {
            name: '插件市场（推荐）',
            lang: 'bash',
            code: `# Obsidian → 设置 → 第三方插件
#   ① 关闭安全模式（若未关）
#   ② 社区插件 → 浏览 → 搜索 "owiki" → 安装 owiki-sync
#   ③ 启用，填入服务器地址与同步令牌，完成
#
# 打不开社区市场时，用下方手动安装`,
          },
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
  wiki: {
    title: 'Obsidian 库，浏览器里就是 Wiki',
    subtitle: '不用导出、不用另写一套站点——打开网址，笔记已经是网站',
    desc: 'Obsidian 继续在本地写。同步到 OWiki 之后，同一份 Markdown 在网页上按目录展开、能搜、能点进一篇读完再改。朋友不用装 Obsidian，你自己出差也不用带库。',
    pointBrowse: '左侧目录就是库结构，文件夹和笔记原样展开',
    pointSearch: '按标题、路径搜全文，几百篇笔记几秒找到',
    pointRead: '打开一篇就是阅读页，wikilink、图片、附件都能看',
    pointAnywhere: '手机浏览器也能进，不必在每台设备装 Obsidian',
  },
  share: {
    title: '把笔记分享给任何人',
    subtitle: '公开只读链接 · 无需账号 · 随时关闭',
    desc: '网页上打开一篇笔记，点「分享」开个开关，就有一条公开链接。朋友不用注册、不用装 Obsidian，点开就能读；二维码扫一下，手机上直接看。',
    pointLink: '链接是固定的：关掉再开还是同一条，之前发出去的不作废',
    pointQr: '自带二维码，扫码即读，转发到微信群不用打字',
    pointControl: '不想分享了随时关，链接立即失效；库里的其他笔记依然只在你服务器上',
    pointReadonly: '访客只能读这一篇：正文和附件都能看，但改不了，也看不到你的其他笔记',
  },
  openapi: {
    title: '给 AI 助手一把你笔记库的钥匙',
    subtitle: '/openapi/* REST 接口 · X-API-Key 认证 · 写入实时广播进 Obsidian',
    desc: '在网页上生成一个 API 密钥，AI 助手就能读你的笔记库、帮你写笔记——它写下的内容秒级出现在 Obsidian 里，每条写入都有同步日志可查。',
    codeTitle: '让 AI 写一篇笔记',
    skillBadge: '官方 Agent Skill',
    skillCta: '查看 Skill 原文',
    skillHint: '纯文本，可直接拷进 AI 助手的技能目录',
    code: `KEY=owk_xxx   # Web 管理端「API 密钥」页生成

# 列出 vault
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults

# 写入笔记 —— Obsidian 端实时收到
curl -s -X POST \\
  "http://localhost:8787/openapi/vaults/1/notes/AI/新文章.md" \\
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \\
  -d '{"content": "# 由 AI 创建\\n\\n来自 agent 的第一条笔记。"}'`,
    points: [
      '新建 / 读取 / 更新 / 删除 / 搜索笔记，全覆盖',
      '附带 agent skill 文档，放进 AI 助手的技能目录就能上手',
      '每条 API 写入都进同步日志，来源标记为 openapi',
      '密钥只存摘要、明文只显示一次，可随时吊销',
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
        desc: '未内置 TLS，建议置于 caddy/nginx 反代之后；除 /api/health 与登录接口外全部需要认证。',
      },
    ],
  },
  faq: {
    title: '常见问题',
    items: [
      {
        q: '和 Obsidian 官方 Sync、iCloud 同步有什么区别？',
        a: '官方 Sync 按月订阅且数据在官方服务器；iCloud 在多平台可靠性和版本控制上有限制。OWiki 数据完全自持——明文 SQLite 文件在你自己的机器上，设备数量没有订阅门槛。同步上来的笔记库同时就是一个可浏览、可搜索的 Wiki 网站，还能给 AI 开放读写。',
      },
      {
        q: '这和 Publish / 静态 Wiki 生成器有什么区别？',
        a: '不用另写一套站点、也不用每次构建发布。Obsidian 里保存，网页上几秒就能读到同一篇——阅读、编辑、分享都在这份库上，不是导出的副本。',
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
      {
        q: '不想用分享 / AI 接口怎么办？',
        a: 'Web 设置 → 插件，像 Obsidian 一样拨开关。关掉后对应入口立刻从界面消失，已发出的公开链接立刻 404；数据还在，重开就回来。不需要重启服务。',
      },
    ],
  },
  footer: {
    tagline: '自部署的 Obsidian 同步 + Wiki',
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
    body: 'OWiki is in an early experimental stage. The sync logic has not been validated at scale, and edge cases may cause note data loss or corruption. Back up your Obsidian vault before connecting (keep a full copy independent of the sync pipeline). We are not responsible for any data loss caused by using this project.',
  },
  nav: {
    wiki: 'Wiki',
    features: 'Features',
    sync: 'How it works',
    architecture: 'Architecture',
    quickstart: 'Quick start',
    openapi: 'AI API',
    security: 'Security',
    faq: 'FAQ',
    skill: 'Skill',
    source: 'Source',
    langToggle: '中文',
    themeToggle: '切换主题',
  },
  hero: {
    badge: 'Open source · MIT License',
    title1: 'Turn your Obsidian vault',
    title2: 'into a wiki website',
    subtitle:
      'Same vault. Open a URL and browse, search, edit — read your notes like a website. Sync, sharing and AI all live on your own machine.',
    ctaPrimary: 'Get started',
    ctaSecondary: 'View source',
    chips: ['Obsidian becomes a wiki', 'Realtime multi-device sync', 'Conflicts never lose content', 'Open AI API'],
    demo: {
      title: 'Syncing',
      mac: 'Mac · Obsidian',
      nas: 'NAS · OWiki server',
      phone: 'Phone · Obsidian',
      saved: 'Saved 2026-08-plan.md',
      reconcile: 'Reconciled · only 1 file changed',
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
        title: 'Only changed files move',
        desc: 'Untouched notes never travel a byte. Re-checking a vault of several hundred files takes seconds; when devices match, traffic is zero.',
      },
      {
        icon: 'radio',
        title: 'Realtime multi-device sync',
        desc: 'Save on one device and every other device gets it within 2 seconds — edits, renames and deletes follow along. Offline changes queue locally and deliver on reconnect.',
      },
      {
        icon: 'gitMerge',
        title: 'Conflicts never lose content',
        desc: 'When two devices edit the same note, mergeable changes merge automatically; the rest are saved as xxx.conflict.md copies — your local file is never silently overwritten.',
      },
      {
        icon: 'bookOpen',
        title: 'Obsidian becomes a wiki',
        desc: 'Once the vault is synced, open a browser and it is your personal wiki: folders, search, reading and editing — no Obsidian install required.',
      },
      {
        icon: 'globe',
        title: 'Any device, just a URL',
        desc: 'Phone, work laptop, tablet — open the URL and you are in your wiki. Device authorization and sync logs live on the same page.',
      },
      {
        icon: 'shieldCheck',
        title: 'Per-device authorization',
        desc: 'Every device has its own identity, joins via PIN, and can be unbound whenever you like. Even iCloud-shared vaults never mix up their devices.',
      },
      {
        icon: 'bot',
        title: 'Open API for AI',
        desc: 'Hand your AI assistant a key and it can read your notes and write for you — what it writes lands in Obsidian seconds later.',
      },
      {
        icon: 'share2',
        title: 'Note sharing',
        desc: 'Flip a switch on any note for a public read-only link — send it to a friend, they scan and read. Turn it off when done and the link dies instantly.',
      },
      {
        icon: 'puzzle',
        title: 'Features you can turn off',
        desc: 'Like Obsidian core plugins: note sharing, sync log, AI API, MCP. Flip a switch in Settings and they vanish from the UI; public links 404 immediately. Data stays; turn them back on and they return.',
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
  johnhom1024/owiki:latest`,
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
        desc: 'Now on the Obsidian community plugin market: Settings → Community plugins → Browse, search owiki-sync and install, enter the server URL and token — the first reconciliation pulls everything down.',
        tabs: [
          {
            name: 'Plugin market (recommended)',
            lang: 'bash',
            code: `# Obsidian → Settings → Community plugins
#   1. Turn off Restricted mode (if on)
#   2. Community plugins → Browse → search "owiki" → install owiki-sync
#   3. Enable it, enter server URL + sync token, done
#
# If the community market is unreachable, use Manual install below`,
          },
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
  wiki: {
    title: 'Your Obsidian vault, a wiki in the browser',
    subtitle: 'No export, no second site — open the URL and the notes already are the website',
    desc: 'Keep writing in Obsidian. Once it syncs to OWiki, the same Markdown opens as a site: folders, search, a reading page, then edit if you want. Friends do not need Obsidian; you do not need the vault on every machine.',
    pointBrowse: 'The sidebar is your vault: folders and notes, as they are',
    pointSearch: 'Search by title or path — hundreds of notes, a few seconds',
    pointRead: 'Open a note and read it: wikilinks, images, attachments included',
    pointAnywhere: 'A phone browser is enough — no Obsidian install on every device',
  },
  share: {
    title: 'Share any note with anyone',
    subtitle: 'Public read-only links · no account needed · close anytime',
    desc: 'Open a note on the web, flip the "Share" switch, and you have a public link. Friends need no account and no Obsidian — they just open it and read. The built-in QR code gets phones there in one scan.',
    pointLink: 'The link is stable: toggle sharing off and on and it is still the same URL you already sent out',
    pointQr: 'Built-in QR code — scan and read on a phone, no typing links into chats',
    pointControl: 'Turn it off anytime and the link dies instantly; the rest of your vault stays on your server',
    pointReadonly: 'Visitors read exactly this one note: body and attachments visible, nothing editable, no way to browse your other notes',
  },
  openapi: {
    title: 'Hand your AI agent the key to your vault',
    subtitle: '/openapi/* REST · X-API-Key auth · writes broadcast live into Obsidian',
    desc: 'Generate an API key on the web console and your AI assistant can read your vault and write notes for you — what it writes lands in Obsidian seconds later, with every write visible in the sync log.',
    codeTitle: 'Let an AI write a note',
    skillBadge: 'Official Agent Skill',
    skillCta: 'View skill (plain text)',
    skillHint: 'Raw markdown — drop it into your assistant’s skills folder',
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
      'Ships an agent skill doc you can drop into your assistant’s skills folder',
      'Every write is recorded in the sync log, tagged source=openapi',
      'Keys stored as digests, plaintext shown once, revocable anytime',
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
        desc: 'No built-in TLS — put OWiki behind a caddy/nginx reverse proxy. Everything except /api/health and the login endpoint requires auth.',
      },
    ],
  },
  faq: {
    title: 'FAQ',
    items: [
      {
        q: 'How is this different from Obsidian Sync or iCloud?',
        a: 'Official Sync is a subscription with data on their servers; iCloud has reliability and versioning limits. OWiki keeps data fully yours — a plain SQLite file on your own machine, unlimited devices. The synced vault is also a browsable, searchable wiki, plus an open API for AI.',
      },
      {
        q: 'How is this different from Publish or a static wiki generator?',
        a: 'No second site to write, no rebuild-and-publish cycle. Save in Obsidian and the same note is readable on the web seconds later — reading, editing and sharing all happen on this vault, not on an exported copy.',
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
      {
        q: 'What if I do not want sharing or the AI API?',
        a: 'Settings → Plugins, same idea as Obsidian core plugins. Turn a feature off and its UI vanishes immediately; public links 404 on the next request. Data stays; turn it back on and it returns. No restart.',
      },
    ],
  },
  footer: {
    tagline: 'Self-hosted Obsidian sync + wiki',
    links: {
      product: 'Product',
      repo: 'Repository',
      license: 'MIT License',
    },
    builtWith: 'OWiki website · built by johnhom',
  },
}

export const content: Record<Lang, Content> = { zh, en }
