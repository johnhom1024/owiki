export type DocSection = {
  id: string
  title: string
  paragraphs?: string[]
  steps?: string[]
  code?: { language: string; value: string }
  notice?: string
  image?: { src: string; alt: string }
  links?: { label: string; href: string }[]
}

export type DocPage = {
  slug: string
  group: string
  title: string
  description: string
  sections: DocSection[]
}

const serverRepo = 'https://github.com/johnhom1024/owiki'
const pluginRepo = 'https://github.com/johnhom1024/owiki-sync'

const dockerStart = `docker run -d --name owiki --restart unless-stopped \\
  -p 8787:8787 \\
  -e OWIKI_ADMIN_PASSWORD='replace-with-your-strong-password' \\
  -v "$PWD/owiki-data:/data" \\
  johnhom1024/owiki:latest`

const compose = `services:
  owiki:
    image: johnhom1024/owiki:latest
    container_name: owiki
    ports:
      - '8787:8787'
    environment:
      OWIKI_ADMIN_PASSWORD: 'replace-with-your-strong-password'
    volumes:
      - ./owiki-data:/data
    restart: unless-stopped`

const developmentSetup = `git clone https://github.com/johnhom1024/owiki.git
cd owiki
cp .env.example .env`

const health = `curl --fail --show-error http://localhost:8787/api/health
docker logs --tail 100 owiki`
const attachments = 'png, jpg, jpeg, gif, webp, svg, bmp, ico, avif, pdf'

export const docs: Record<'zh' | 'en', DocPage[]> = {
  zh: [
    {
      slug: 'introduction', group: '开始使用', title: '认识 OWiki',
      description: '把 Obsidian 同步、浏览器笔记库与自动化接口放在你自己的服务器上。',
      sections: [
        { id: 'what-is-owiki', title: '一套服务，三种使用方式', paragraphs: ['OWiki 服务端保存笔记并协调设备间的同步；OWiki Sync 插件连接 Obsidian 本地库；内置 Web 管理端让你在浏览器里管理、阅读和编辑笔记。无需另外部署一个 Web 应用。', '希望让脚本或 AI 整理笔记时，可以单独启用 REST /openapi/* 或 MCP /mcp，并发放限定权限的 API 密钥。它们不是 Obsidian 插件的同步接口。'], image: { src: 'screenshots/home-zh.jpg', alt: 'OWiki 中文 Web 管理端首页与笔记库列表' } },
        { id: 'vaults', title: '本地库与远程 Vault', paragraphs: ['Obsidian vault 是设备上的本地文件夹；OWiki vault 是服务器里独立的笔记空间，有自己的同步令牌和设备列表。多个本地库可以连接同一远程 vault，但接入前必须核对目标。', '同步是双向的，不是只上传备份。第一次确认连接后，会对比两端文件清单，按差异上传和下载。请先用空白或非关键测试库验证。'] },
        { id: 'data-boundary', title: '数据存在哪里', paragraphs: ['笔记内容、配置、设备与授权等数据保存在 SQLite；图片和 PDF 等附件的二进制内容另存于 attachments 目录，数据库保存其元数据。默认 Docker 布局将两者都放进 /data。', '数据由你托管，也意味着磁盘、访问控制、HTTPS、备份和恢复由你负责。HTTPS 保护传输，但 OWiki 不是端到端加密存储，服务器需要读取笔记内容来提供 Web 与 AI 功能。'], notice: 'OWiki 和 OWiki Sync 仍处于早期试验阶段，异常情况下可能丢失或损坏数据。接入前保留独立于同步链路的完整备份；同步副本和冲突副本都不能替代备份。' },
        { id: 'next', title: '选择下一步', paragraphs: ['第一次使用，从快速开始完成一个小库的双向验证；准备长期运行，再阅读 Docker 部署和备份维护。'], links: [{ label: '服务端源码与 Releases', href: serverRepo }, { label: 'Obsidian 插件源码', href: pluginRepo }, { label: 'AI 接口与 Skill 文档', href: `${serverRepo}/blob/main/docs/openapi-skill.md` }] },
      ],
    },
    {
      slug: 'quickstart', group: '开始使用', title: '快速开始',
      description: '启动服务、创建远程库、确认连接，再验证一次完整的双向同步。',
      sections: [
        { id: 'prepare', title: '开始前准备', steps: ['备份本地 Obsidian 库，最好先建一个只有几篇笔记的测试库。不要让另一套同步工具同时写入这个测试目录。', '准备可运行 Docker 的主机，以及安装了 OWiki Sync 所需版本的 Obsidian。当前插件源码要求 Obsidian 1.13.0 或更高，支持桌面和移动端。'], notice: '手机上的 localhost 指手机本身，不是你的服务器。跨设备访问使用服务器地址；公网访问前配置 HTTPS 和 WebSocket 代理。' },
        { id: 'start', title: '1. 用 Docker 启动服务端', paragraphs: ['先把 replace-with-your-strong-password 替换为自己的强密码，再执行下面的命令。已有名为 owiki 的容器时，不要重复创建。数据保存在当前目录的 owiki-data 中。', '长期运行推荐 Docker Compose；修改源码请看独立的本地开发指南。'], code: { language: 'bash', value: dockerStart }, notice: '示例会向主机网络开放 8787 端口：仅在可信局域网使用，并用防火墙限制访问；公网访问前必须配置 HTTPS。命令历史和 Docker 环境中可见密码，不要分享。', links: [{ label: 'Docker Compose（长期运行推荐）', href: '?page=docker#compose' }, { label: '本地开发', href: '?page=development' }] },
        { id: 'create-vault', title: '2. 登录并创建远程 Vault', steps: ['在服务器本机浏览器打开 http://localhost:8787，用 admin 和刚才输入的密码登录。远程主机使用已配置的安全访问地址。', '创建一个名称清晰的 vault，进入该库设置页，获取 WebSocket 地址和同步令牌。', '保存好目标库名。同步令牌属于这个远程库，不是管理员密码，也不是 AI API 密钥。'], image: { src: 'screenshots/home-zh.jpg', alt: '在 OWiki 中文管理端创建和管理远程 Vault' } },
        { id: 'connect', title: '3. 安装插件并确认同步目标', steps: ['在 Obsidian 社区插件里查找 OWiki Sync 并启用；若市场暂不可用，从插件 Releases 手动安装 main.js、manifest.json 和 styles.css。', '打开目标本地库里的插件设置，填写完整 ws://…/ws 或 wss://…/ws 地址、同步令牌和远程库名；也可使用 Web 库设置中的一键授权。', '点击连接后，核对弹窗中的本地库与远程库，再确认开始同步。当前流程通过令牌认证并登记设备，不需要输入设备 PIN。', '等首次对账结束：在 Obsidian 新建一篇测试笔记，在 Web 确认出现；再从 Web 编辑，回到 Obsidian 检查内容。随后用一张测试图片验证附件。'], notice: '先验证，再接入重要笔记或第二台设备。删除和重命名也会传播，测试时只操作可丢弃的文件。', links: [{ label: '下载 OWiki Sync', href: `${pluginRepo}/releases` }] },
      ],
    },
    {
      slug: 'docker', group: '部署与运维', title: 'Docker 部署',
      description: '用 Docker Compose 长期运行，或用一条 Docker 命令快速启动。',
      sections: [
        { id: 'compose', title: 'Docker Compose（推荐）', paragraphs: ['安装 Docker 和 Compose 插件，将下面的内容保存为 compose.yaml。先把 replace-with-your-strong-password 替换为自己的强密码，再启动。无需克隆源码或准备其他配置文件。', '数据库和附件保存在同目录的 owiki-data 中。Compose 和 docker run 二选一，避免两个实例使用同一个数据目录。'], code: { language: 'yaml', value: compose }, notice: '示例会开放主机的 8787 端口，仅在可信局域网使用并用防火墙限制访问；公网访问前配置 HTTPS。compose.yaml 含明文密码，不提交、不分享。' },
        { id: 'compose-start', title: '启动 Compose 服务', paragraphs: ['在 compose.yaml 所在目录执行，然后打开 http://localhost:8787，用 admin 和设置的密码登录；其他设备使用服务器的安全访问地址。'], code: { language: 'bash', value: 'docker compose up -d' }, notice: '不要删除或清空 owiki-data，也不要把 docker compose down -v 当作常规升级步骤。' },
        { id: 'run', title: '替代方式：单容器启动', paragraphs: ['不使用 Compose 时，可直接运行下面的命令。先把 replace-with-your-strong-password 替换为自己的强密码。数据保存在当前目录的 owiki-data 中。', '只用于首次创建容器，不要与上述 Compose 实例同时运行。密码可见于命令历史和 Docker 环境，不要分享。'], code: { language: 'bash', value: dockerStart } },
        { id: 'image', title: '选择镜像与版本', paragraphs: ['官方镜像源是 johnhom1024/owiki 和 docker.cnb.cool/johnhom1024/owiki。国内网络可选择 CNB 源，并沿用相同的实际发行 tag。', '镜像 tag 对应 Git 发行 tag 去掉 v 前缀；latest 是随正式版变化的标签，预发布使用明确的 -beta.N tag。生产建议固定已验证版本或 digest，升级时主动修改，不依赖 latest 自动变化。', '仓库发布流程当前构建 linux/amd64。ARM 主机部署前检查目标镜像支持的平台，不要假定有原生 arm64 镜像。'], links: [{ label: '镜像与版本策略', href: `${serverRepo}/blob/main/docs/versioning.md` }, { label: 'Docker Hub', href: 'https://hub.docker.com/r/johnhom1024/owiki' }] },

        { id: 'proxy', title: '反向代理与 HTTPS', paragraphs: ['默认服务监听 :8787，不提供 TLS。公网部署应由 Caddy、nginx 等反向代理终止 HTTPS，并把 Web 页面、/api、/openapi、/mcp 和 /ws 按需转发到同一服务。/ws 必须支持 WebSocket Upgrade 和长连接。', '示例开放主机的 8787 端口。使用同机宿主代理时，可改为 127.0.0.1:8787:8787，避免直接暴露后端；容器化代理通常与 OWiki 位于同一 Docker 网络，通过服务名访问 8787，而不是宿主回环地址。', '插件在 HTTPS 域名下使用 wss://你的域名/ws。转发正确的 Host 与 X-Forwarded-Proto，避免 Web 生成的一键授权地址使用内部主机名或 ws://。不要把不受信任的代理头直接暴露给服务。'] },
        { id: 'verify', title: '检查部署结果', paragraphs: ['健康接口应返回 status、clients 和 version。它只能说明进程可访问，不能替代登录、附件读写和真实设备同步验证。'], code: { language: 'bash', value: health } },
      ],
    },
    {
      slug: 'development', group: '部署与运维', title: '本地开发',
      description: '仅在修改源码时使用；部署服务优先选择 Docker 或 Docker Compose。',
      sections: [
        { id: 'prerequisites', title: '开发环境', paragraphs: ['安装 Git、Make、Go 1.26.7 或更高版本（见 go.mod），以及 Node.js 和 pnpm 11.15.0（见 web/package.json）。建议使用 Node.js 24 LTS；web/package.json 未单独声明 Node engines。'], links: [{ label: 'Docker 部署', href: '?page=docker#compose' }] },
        { id: 'clone', title: '1. 克隆并准备配置', code: { language: 'bash', value: developmentSetup } },
        { id: 'password', title: '2. 编辑管理员密码', paragraphs: ['用编辑器打开 .env，把 OWIKI_ADMIN_PASSWORD 改为自己的强密码并保存；不要使用示例密码，也不要提交或分享 .env。此密码只在首次初始化管理员时生效。'] },
        { id: 'start', title: '3. 启动开发环境', paragraphs: ['在 owiki 目录执行 make dev。它会启动后端（8787）和前端开发服务（5174），缺少 Web 依赖或构建产物时会自动安装、构建。', '浏览器打开 http://localhost:5174，用 admin 和刚设置的密码登录。开发环境仅用于本地测试，不要直接暴露到公网。'], code: { language: 'bash', value: 'make dev' } },
      ],
    },
    {
      slug: 'configuration', group: '部署与运维', title: '配置与凭据',
      description: '了解首次初始化、数据路径和三类凭据，避免把令牌填错位置。',
      sections: [
        { id: 'environment', title: '服务端环境变量', paragraphs: ['OWIKI_ADDR：监听地址，默认 :8787。OWIKI_DB：SQLite 路径，直接运行默认 owiki.db，官方容器默认 /data/owiki.db。', 'OWIKI_ATTACH_DIR：附件目录，默认是数据库同目录的 attachments。若改到 /data 以外，必须单独持久化和备份。', 'OWIKI_ADMIN_USER：首次初始化用户名，默认 admin。OWIKI_ADMIN_PASSWORD：首次初始化密码；为空且没有已有管理员时不会创建账户。', 'OWIKI_TOKEN：只用于把 vault_id=0 的旧笔记迁入 default vault。新部署不用设置；请在 Web 创建 vault 并使用其独立令牌。不要沿用 .env.example 中的开发令牌或示例密码。', '从源码本地运行时会加载 .env，但不会覆盖已经设置的进程环境变量。生产容器使用 --env-file 或 Compose 传入配置。'] },
        { id: 'admin', title: '管理员账户：登录 Web', paragraphs: ['管理员用户名与密码用于 Web 会话，管理 vault、设备、功能开关和 API 密钥。管理员可以访问服务中的笔记，勿把管理员权限交给只需要读取一个库的脚本。', '已有账户保存在数据库中；之后修改 OWIKI_ADMIN_USER 或 OWIKI_ADMIN_PASSWORD 并重启，不会覆盖账户，也不是密码重置方法。不要为重置密码删除数据库。Web 账户安全设置支持 TOTP 二次认证。'] },
        { id: 'sync-token', title: '同步令牌：连接 Obsidian', paragraphs: ['每个 vault 的同步令牌在该库设置页获取。插件用它定位并认证远程库，然后登记设备身份；远程库名用于人工核对。当前实现没有额外的 PIN 配对步骤。', '一键授权链接也携带连接凭据，按密码对待，不要贴进公开聊天、截图或工单。设备名称只是辨认标签，不是密钥。', '仅轮换 token 不等同于立即关闭已有连接。若凭据泄漏，使用该库的“取消全部授权”：它清理设备、轮换令牌并断开该库现有连接，然后只给可信设备重新授权。'] },
        { id: 'api-keys', title: 'API 密钥：脚本与 AI', paragraphs: ['在 Web 的 API 密钥页创建，REST /openapi/* 与 MCP /mcp 共用这一类密钥。可限制 vault 范围、设为只读，服务端以 SHA-256 摘要存储 API 密钥。', 'REST 支持 X-API-Key 或 Bearer 认证；MCP 可使用 X-API-Key。优先使用请求头，不把密钥放进 URL，避免被浏览器历史、代理日志或分享链接记录。', '管理员密码、vault 同步令牌与 API 密钥用途不同，不能互相替代。为每个集成单独发放最小权限密钥，停止使用时撤销。'], links: [{ label: 'REST、MCP 与 Agent Skill 接入', href: `${serverRepo}/blob/main/docs/openapi-skill.md` }] },
        { id: 'features', title: '内置功能开关', paragraphs: ['OWIKI_SHARE、OWIKI_SYNCLOG、OWIKI_APIKEYS、OWIKI_MCP 控制对应功能在尚无保存值时的默认状态：留空为开，设为 off 为关。日常请在 Web“设置 → 插件”调整；已有保存值优先于环境变量。', '关闭功能会隐藏入口并限制相应服务接口，不会删除其数据。关闭文章分享后，已发出的公开链接也不可访问；重新开启时仍需检查哪些旧链接重新可用。'] },
      ],
    },
    {
      slug: 'maintenance', group: '部署与运维', title: '备份、升级与维护',
      description: '备份数据库和附件，并在升级前准备可验证的恢复路径。',
      sections: [
        { id: 'backup', title: '备份完整数据，而不是只复制数据库', paragraphs: ['默认 Docker 数据目录包含 owiki.db 与 attachments，还可能存在 SQLite 的 -wal / -shm 文件。运行时只复制一个数据库文件可能不一致；只备份数据库则会遗漏附件正文。', '最简单的维护窗口备份：暂停各端写入，停止 OWiki 容器，将整个 owiki-data 复制到独立位置，再启动服务。若自定义 OWIKI_ATTACH_DIR，也一起备份。保留权限、版本号与部署配置；凭据文件的副本需加密或单独安全保存。'], steps: ['通知使用者暂停 Obsidian、Web 和自动化写入。', '执行 docker stop owiki，确认停止后，给完整数据目录做带日期的副本或快照。', '执行 docker start owiki，检查健康接口、登录和测试笔记。', '定期在隔离环境恢复备份，实际打开一篇笔记和一张附件；保留多代备份。'], notice: '不要让测试恢复实例与生产设备连接同一个远程地址。同步会传播删除和错误，独立的本地 vault 备份也应保留。' },
        { id: 'upgrade', title: '有准备地升级', steps: ['阅读目标发行说明，记录当前镜像 tag 或 digest、插件版本和数据路径。0.x 阶段可能出现协议或 API 变化。', '先完成完整备份，最好在测试实例上验证目标版本与插件兼容。', 'Compose 部署修改 compose.yaml 中的 image tag，执行 docker compose pull 与 docker compose up -d；docker run 部署则停止并替换容器，复用原数据挂载与配置。', '检查 /api/health 的 version，再验证登录、Web 编辑、插件重连及附件下载。确认无误后恢复正常写入。'], links: [{ label: '服务端 Releases', href: `${serverRepo}/releases` }, { label: '插件 Releases', href: `${pluginRepo}/releases` }] },
        { id: 'rollback', title: '回退不只是换镜像', paragraphs: ['旧镜像不一定能读取新版本迁移后的数据库。不要在唯一一份生产数据上反复试跑不同版本。回退前停止写入并保留当前现场；必要时将升级前的完整数据备份与当时的镜像配套恢复。', '恢复旧快照会丢弃快照后的服务端变化。重新连接设备前先备份各端当前文件，并规划如何处理它们与恢复库之间的差异，避免马上触发不受控的双向对账。'] },
        { id: 'diagnostics', title: '日常检查与故障证据', paragraphs: ['检查磁盘空间、数据目录写权限、容器重启次数和反向代理错误。服务端日志与插件“诊断”可用于核对连接状态和两端版本。', '启用同步日志后，Web 库设置可查看变更、删除与冲突事件。当前清理策略是保留约 30 天且单库最多 5000 条，按日清理；这不是无限历史或可恢复版本库。', '报告问题时附两端版本、脱敏日志、发生时间、操作顺序、是否使用其他同步软件以及最小复现步骤。移除 token、API key、管理员信息和私人笔记正文。'], code: { language: 'bash', value: health }, links: [{ label: '报告问题', href: `${serverRepo}/issues` }, { label: '安全问题报告方式', href: `${serverRepo}/blob/main/SECURITY.md` }] },
      ],
    },
    {
      slug: 'plugin', group: '使用指南', title: 'Obsidian 插件',
      description: '安装 OWiki Sync，正确授权每台设备，并读懂设置中的连接状态。',
      sections: [
        { id: 'install', title: '安装与更新', paragraphs: ['在 Obsidian“设置 → 第三方插件”中查找 OWiki Sync，安装并启用。若市场不可用，可手动安装，或通过 BRAT 添加 johnhom1024/owiki-sync。当前源码要求 Obsidian 1.13.0 及以上，插件不限定桌面端。'], steps: ['手动安装时，从同一个插件 Release 下载 main.js、manifest.json、styles.css。', '将三件套放到目标库的 .obsidian/plugins/owiki-sync/ 目录；若使用自定义配置目录，以实际 configDir 为准。', '重新加载 Obsidian 插件列表并启用 OWiki Sync。升级前先备份库，并查看该版本发行说明。'], links: [{ label: '插件下载', href: `${pluginRepo}/releases` }, { label: 'BRAT', href: 'https://github.com/TfTHacker/obsidian42-brat' }] },
        { id: 'pair', title: '填写连接信息并确认', paragraphs: ['从 Web 远程库设置复制 WebSocket 地址与同步令牌。手动连接还要填写远程库名；本地文件夹名称可以不同，但必须确认两者就是想连接的一对。', 'Web 的一键授权会唤起 Obsidian 并填入连接信息，同样需要核对并确认。先打开正确的本地库，尤其是同时使用多个 vault 时。成功认证后服务器自动登记设备；无需创建或输入 PIN。'], image: { src: 'screenshots/plugin-settings-zh.jpg', alt: 'OWiki Sync 中文设置：连接状态、设备、同步与诊断' }, code: { language: 'text', value: '本机测试：ws://localhost:8787/ws\nHTTPS 域名：wss://notes.example.com/ws\n另需：该库的同步令牌 + 远程库名' } },
        { id: 'controls', title: '同步控制与设备身份', paragraphs: ['自动同步默认开启，本地编辑按约 2 秒防抖收集后上传；“立即同步”会重新上报清单，按差异上传或下载。“刷新授权”通过重连检查令牌，不是重置令牌。', '自动同步开关控制本地事件的自动推送，不是全局断网开关：连接与远端消息仍可能存在。需要隔离库进行修复时，先断开或禁用插件，并关闭其他写入来源。', '设备名修改后点击保存才会重连并更新服务器。设备 ID 保存在设备本地存储，避免随着插件配置文件同步而让多台设备共享身份。不要用复制身份的方式接入新设备。'] },
        { id: 'states', title: '已连接、观察态与取消授权', paragraphs: ['连接中表示网络连接尚未完成；认证失败优先核对 token 与目标库；已连接后还要等首次对账结束，才能判断文件一致。移动端后台运行受系统限制，不要把后台挂起当成一直在线。', '“已连接，但非同步设备”表示远程库开启了单设备同步，本机未被选中：保持连接和心跳，但既不上报文件变化，也不接收文件变更广播。去 Web 库设置切换选中设备，或关闭单设备模式。', '插件危险区的断开并取消授权用于解除当前设备连接，不会删除本地笔记。若 token 已泄漏，在 Web 取消该库全部授权并重新发放，不能只依赖本机断开。'] },
      ],
    },
    {
      slug: 'sync', group: '使用指南', title: '同步机制与冲突',
      description: '理解对账、实时变更和冲突副本的边界，让多端协作更可控。',
      sections: [
        { id: 'reconcile', title: '先对账，再传变化的内容', paragraphs: ['插件通过 /ws 发送 hello，用同步令牌认证远程库并报告设备身份。认证完成且允许同步后，hashlist 上报路径、哈希与修改时间；服务端返回差异，客户端再上传或 fetch 下载内容。', '内容哈希相同的文件无需重复传正文，但对账清单和心跳仍会产生网络流量。“增量”是文件级变化传输，不代表永远零流量，也不是字符级补丁传输。', '首次同步不是只从服务器恢复：本地已有文件也可能被上传。对账会处理两端差异，所以不要把未知内容的两个库直接配对。'] },
        { id: 'scope', title: '哪些内容会同步', paragraphs: [`当前插件同步 Markdown（.md）和白名单附件：${attachments}。不要假定任意格式、音视频或整个配置目录都会同步。`, '首次清单扫描排除 Obsidian 配置目录以及 .conflict.md 副本。OWiki 不是 .obsidian 配置同步工具；插件、主题、快捷键和工作区设置应另行管理。', '在线时，本地创建和修改触发上传，删除与重命名也会发送到服务端并广播给有同步资格的设备。远端删除会影响本地文件，不能把另一台设备当作不会变化的备份。'] },
        { id: 'offline', title: '断线重连与单设备同步', paragraphs: ['客户端断线后指数退避重连，延迟上限约 30 秒；重连认证后重新对账。本地文件仍是离线编辑的基础，待上传集合和消息队列不是跨崩溃的完整操作日志，不应承诺所有离线操作永不丢失。', '单设备同步仅允许被选中的插件设备交换文件；其他设备仍可连接和登记，但没有文件上传、拉取或广播。它不是只读实时镜像，也不是 Web/API 写入的全局锁。恢复资格后客户端重新对账。', '不要让多台设备一边通过 iCloud 同步同一个库，一边全部通过 OWiki 交换同一批文件。已有 iCloud 的用户按下方单设备方案配置，先在测试库验证；也不要继续叠加 Obsidian Sync 等其他双向同步通道。'] },
        {
          id: 'icloud', title: 'iCloud 同步方式：设置单设备同步',
          paragraphs: ['如果你的 Mac、iPhone、iPad 已经通过 iCloud 同步同一个 Obsidian 库，不必再让每台设备都通过 OWiki 同步一遍。推荐保留 iCloud 负责苹果设备之间的文件同步，只选一台常用、能保持 Obsidian 运行的 Mac，作为连接 OWiki 服务端的同步设备。', '文件流向是：iPhone / iPad ↔ iCloud ↔ 选定的 Mac（OWiki Sync）↔ OWiki 服务端。这里仍是双向同步，不是单向上传：Web 或 API 的修改先同步到这台 Mac，再由 iCloud 传到其他苹果设备。'],
          steps: ['先备份整个库，暂停各端编辑，等待 iCloud 把笔记与附件同步完整。确认选定 Mac 上的文件已下载到本地，而不是尚未下载的云端占位文件；先用测试库验证。', '先只在选定 Mac 的目标库中配置 OWiki Sync，连接对应远程 vault，并核对本地库和远程库。其他设备暂时不要接入 OWiki，避免尚未开启单设备模式时同时对账。', '打开 OWiki Web → 进入对应 vault 的设置 → 找到已授权设备与「单设备同步」。至少有一台设备成功连接、登记后，开关才可用。', '打开「单设备同步」，核对确认弹窗中的设备后确认。首次开启可能默认选中最近在线的设备，不一定是你想用的 Mac。', '在「作为同步设备的设备」下拉框中选择这台 Mac；对照设备名称和设备 ID，确认切换。保持这台 Mac 的 Obsidian、OWiki Sync 和自动同步开启。', '其他苹果设备继续使用 iCloud 即可，无需专门连接 OWiki。如果它们已经安装并连接插件，开启单设备模式后会显示「已连接，但非同步设备」：这是正常观察态，不通过 OWiki 上传、下载或接收文件变更，文件仍由 iCloud 更新。', '验证一次完整链路：在 iPhone 新建测试笔记，等 iCloud 同步到选定 Mac 后检查 Web；再从 Web 修改这篇笔记，检查 Mac 和 iPhone。也用一张测试图片验证附件。'],
          notice: '选定 Mac 关机、休眠、Obsidian 退出或插件断线时，iCloud 仍可在苹果设备之间同步，但 OWiki 服务端不会因此直接收到 iCloud 的变化，也不会自动切换到另一台设备。单设备模式不是备份，也不能消除 iCloud 自身的冲突；避免同时在多处编辑同一篇笔记。',
          links: [{ label: '插件连接状态说明', href: '?page=plugin#states' }, { label: '备份与恢复', href: '?page=maintenance#backup' }],
        },
        {
          id: 'icloud-switch', title: 'iCloud 场景下如何切换同步设备',
          paragraphs: ['需要换另一台 Mac 接力时，先暂停各端和 Web / API 写入，等待 iCloud 在新旧设备之间同步完成，备份并确认新 Mac 的笔记与附件已完整下载。不要直接关闭单设备同步来“临时放行”所有设备。', '保持单设备模式开启，让新设备连接并登记（此时可处于观察态），再到 Web 的「作为同步设备的设备」下拉框选中新设备并确认。旧设备会失去同步资格；新设备恢复资格并重新对账后，重新做一次双向测试。切换选中设备不会替你完成 iCloud 的文件下载。'],
        },
        { id: 'conflicts', title: '冲突发生后怎么办', paragraphs: ['服务端利用客户端上次同步的 baseHash 和已有快照尝试三方合并。能干净合并时保存合并结果；无法合并时向插件返回冲突，而不是承诺任何情况下都能自动保留全部历史。', 'Markdown 冲突时，插件保留当前本地文件，把远程内容写入同目录的“原名.conflict.md”。这类副本不会继续同步；相同路径的旧冲突副本可能被更新，因此发现冲突后先另存两份重要内容。'], steps: ['暂停其他设备对这篇笔记的编辑，独立备份本地原文与冲突副本。', '并排比较原文件和 .conflict.md，将需要保留的内容整理进原文件。', '保存原文件以重新尝试上传，再核对 Web 和其他设备的结果。', '确认所有需要的内容都已保留后，再手动清理冲突副本。'], notice: '冲突副本不是版本历史；二进制附件也不能按 Markdown 的三方文本合并规则处理。不要依赖“永不覆盖”之类的绝对保证。' },
      ],
    },
    {
      slug: 'web', group: '使用指南', title: 'Web 笔记库与分享',
      description: '在浏览器里阅读、编辑、管理和分享，同时控制自动化访问权限。',
      sections: [
        { id: 'library', title: '浏览器里的笔记库', paragraphs: ['用管理员账户登录服务地址，从首页进入远程 vault。Web 展示的是服务器已经收到的数据，而不是实时读取某台电脑的本地文件夹。插件离线期间的本地编辑，要等成功上传后才会出现在这里。', '在库内浏览文件、阅读和编辑笔记，也可新建 Markdown。Web 写入通过同一服务保存并广播给可同步的 Obsidian 设备。移动浏览器可以访问，不需要在该设备安装 Obsidian。'], image: { src: 'screenshots/home-zh.jpg', alt: 'OWiki 中文 Web 首页：远程库概览' } },
        { id: 'vault-settings', title: '管理远程库与设备', paragraphs: ['库设置集中提供同步令牌、一键授权、设备状态、单设备同步和同步日志。已授权不一定表示正在交换文件：离线设备与观察态设备应结合连接状态一起判断。', '删除远程 vault 是破坏性操作，会清理该库服务端笔记、设备记录等数据。它不是“退出登录”或“解绑本机”；请先备份并确认要删除的库。'] },
        { id: 'share', title: '把单篇笔记分享给别人', paragraphs: ['启用文章分享后，在笔记详情页创建公开链接，可配合二维码发送。收件人不需要管理员账号；请把公开链接视为允许外部访问的凭证，分享前检查正文、嵌入图片和敏感信息。', '不再需要公开时，在分享管理中撤销链接；全局关闭分享功能会让现有链接不可用，但不删除分享数据。重新开启功能后需重新检查旧链接。撤销也无法收回别人已经保存的副本。'], image: { src: 'screenshots/share-zh.jpg', alt: 'OWiki 中文文章公开分享页面' } },
        { id: 'integrations', title: '让脚本或 AI 访问', paragraphs: ['在“设置 → 插件”启用所需的 API 密钥与 MCP 功能，再到 API 密钥页创建限定库范围的密钥。先用只读权限验证检索，再按需开放写入。', 'REST 入口是 /openapi/*，MCP 是 /mcp；Web 的 /api/* 使用管理员会话，不应拿它替代面向集成的开放接口。API 写入也会传播到 Obsidian，批量整理前请备份。'], code: { language: 'bash', value: `# OWIKI_API_KEY is supplied securely by your environment\ncurl --fail --show-error \\\n  -H "X-API-Key: $OWIKI_API_KEY" \\\n  https://notes.example.com/openapi/vaults` }, links: [{ label: '完整 AI 接口文档', href: `${serverRepo}/blob/main/docs/openapi-skill.md` }] },
      ],
    },
    {
      slug: 'faq', group: '参考', title: '常见问题',
      description: '从连接失败、授权误解到丢附件，按现象找到排查起点。',
      sections: [
        { id: 'cannot-connect', title: 'Web 能打开，插件为什么连不上？', paragraphs: ['插件需要完整的 WebSocket 地址，不能直接填 Web 页面 URL：本机是 ws://localhost:8787/ws，HTTPS 域名应使用 wss://域名/ws。检查代理是否放行 /ws 的 Upgrade，证书是否受设备信任，防火墙是否允许连接。', '手机或另一台电脑上的 localhost 不指向服务器。本文 Docker 示例开放主机的 8787 端口；跨设备请使用可信局域网中的服务器地址或 HTTPS 代理域名，并检查防火墙。先检查 /api/health，再看插件诊断与代理日志。'] },
        { id: 'auth', title: '去哪里找 PIN？为什么修改环境密码没用？', paragraphs: ['当前代码使用 vault 同步令牌认证并自动登记设备，不需要 PIN。插件手动连接需要 WebSocket 地址、同步令牌和远程库名，并在连接后确认。早期 README 中的 PIN 描述不适用于当前流程。', '管理员环境变量只初始化不存在的账户；已有数据库中的账户不会被重启覆盖。同步令牌在库设置获取，API 密钥在独立的密钥页面创建，三者不能混用。'] },
        { id: 'no-sync', title: '显示已连接，但文件没有同步？', paragraphs: ['先看是否处于“非同步设备”的观察态。该模式下既不上传，也不接收文件广播；在 Web 库设置选择本机或关闭单设备模式。', '再检查自动同步开关、首次确认是否完成、目标远程库是否正确，以及文件是否属于支持范围。点击“立即同步”观察进度和日志；移动端回到前台等待重连后再判断。'] },
        { id: 'missing-files', title: '为什么主题、Canvas、音视频或附件没出现？', paragraphs: [`当前同步范围是 .md 与这些附件：${attachments}。配置目录、.conflict.md，以及不在支持列表中的扩展名不属于完整库同步承诺；例如 .canvas、.base 和音视频不会像普通 Markdown 一样纳入当前清单。`, '若 Web 有笔记却丢失图片，检查附件是否属于支持格式、是否成功上传，以及迁移时是否把 attachments 一起复制。只有 SQLite 的备份并不包含二进制附件正文。'] },
        { id: 'duplicates', title: '出现冲突副本或“文件 2.md”怎么办？', paragraphs: ['先备份原文件与副本，停止多端对同一文件继续编辑。检查是否同时启用 iCloud 或其他双向同步，是否同一库开了多个 Obsidian 实例，以及服务端是否记录重复设备连接。', '.conflict.md 是插件保存远程内容供人工比较的文件，不自动上传；把要保留的内容合并回原文并验证后再清理。不要把删除副本当作解决冲突的唯一动作。'] },
        { id: 'security-and-backup', title: '能直接公开部署吗？同步能替代备份吗？', paragraphs: ['公开部署前设置强管理员密码、HTTPS 与最小权限 API key，妥善保护同步令牌和一键授权链接。服务端可读取笔记内容；自托管不等于端到端加密。', '不能用同步替代备份。删除、误改和异常都可能传播。保留独立 vault 副本，并备份完整服务数据目录；升级前先做恢复演练。OWiki 仍处于试验阶段。'] },
        { id: 'report', title: '仍无法定位问题？', paragraphs: ['整理服务端版本、插件版本、Obsidian 版本、部署方式、操作时间与脱敏日志，并用不含私人内容的小库复现。不要提交 token、授权 URL、API key、密码或数据库文件。安全漏洞按 SECURITY.md 私下报告。'], links: [{ label: '服务端 Issues', href: `${serverRepo}/issues` }, { label: '插件 Issues', href: `${pluginRepo}/issues` }, { label: '安全报告', href: `${serverRepo}/blob/main/SECURITY.md` }] },
      ],
    },
  ],
  en: [
    {
      slug: 'introduction', group: 'Getting started', title: 'Meet OWiki',
      description: 'Self-hosted Obsidian sync, a browser-based notebook, and APIs for your own automation.',
      sections: [
        { id: 'what-is-owiki', title: 'One server, three ways to work', paragraphs: ['The OWiki server stores notes and coordinates devices. OWiki Sync connects your local Obsidian vault. The built-in web console lets you manage, read, and edit notes in a browser; there is no separate web application to deploy.', 'For scripts and AI assistants, optionally enable REST at /openapi/* or MCP at /mcp and issue a scoped API key. These are separate from the Obsidian sync connection.'], image: { src: 'screenshots/home-en.jpg', alt: 'OWiki English web console home and vault list' } },
        { id: 'vaults', title: 'Local vaults and remote vaults', paragraphs: ['An Obsidian vault is a folder on a device. An OWiki vault is a separate server-side note space with its own sync token and device list. Multiple local vaults can connect to one remote vault, but always verify the destination first.', 'Sync is bidirectional, not an upload-only backup. After you confirm the first connection, OWiki compares file inventories and uploads or downloads differences. Start with an empty or disposable test vault.'] },
        { id: 'data-boundary', title: 'Where your data lives', paragraphs: ['SQLite stores note text, settings, devices, and authorization data. Binary attachments such as images and PDFs live in a separate attachments directory, with metadata in the database. The default Docker layout keeps both under /data.', 'Self-hosting puts you in charge of storage, access control, HTTPS, backups, and recovery. HTTPS protects transport; OWiki is not end-to-end encrypted storage. The server needs access to note contents for its web and AI features.'], notice: 'OWiki and OWiki Sync are experimental. Unexpected conditions may cause data loss or corruption. Keep a complete backup outside the sync chain before connecting a vault. Neither another synced device nor a conflict copy replaces a backup.' },
        { id: 'next', title: 'Where to go next', paragraphs: ['Use Quickstart to verify both sync directions with a small vault. Before relying on a long-running server, read Docker deployment and Backup & maintenance.'], links: [{ label: 'Server source and releases', href: serverRepo }, { label: 'Obsidian plugin source', href: pluginRepo }, { label: 'AI API and Skill reference', href: `${serverRepo}/blob/main/docs/openapi-skill.md` }] },
      ],
    },
    {
      slug: 'quickstart', group: 'Getting started', title: 'Quickstart',
      description: 'Start the server, create a remote vault, confirm the connection, and verify both sync directions.',
      sections: [
        { id: 'prepare', title: 'Before you begin', steps: ['Back up your local Obsidian vault. Prefer a test vault with just a few disposable notes, without another sync tool writing to the same directory.', 'Prepare a Docker host and a supported Obsidian installation. The current plugin source requires Obsidian 1.13.0 or later and supports desktop and mobile.'], notice: 'On a phone, localhost means the phone, not your server. Use the server address on other devices; configure HTTPS and WebSocket forwarding before internet access.' },
        { id: 'start', title: '1. Start the server with Docker', paragraphs: ['Replace replace-with-your-strong-password with your own strong password before running the command below. Do not create another container if one named owiki already exists. Data persists in owiki-data under the current directory.', 'For long-term use, choose Docker Compose. For source changes, follow the separate local development guide.'], code: { language: 'bash', value: dockerStart }, notice: 'This example exposes port 8787 on the host network: use a trusted LAN and restrict access with a firewall; configure HTTPS before internet access. The password is visible in shell history and Docker environment settings, so do not share them.', links: [{ label: 'Docker Compose (recommended for long-term use)', href: '?page=docker#compose' }, { label: 'Local development', href: '?page=development' }] },
        { id: 'create-vault', title: '2. Sign in and create a remote vault', steps: ['On the server host, open http://localhost:8787 and sign in as admin with the password you entered. For a remote host, use your configured secure access address.', 'Create a clearly named vault. Open its settings to obtain its WebSocket address and sync token.', 'Keep the remote vault name handy. Its sync token is neither your administrator password nor an AI API key.'], image: { src: 'screenshots/home-en.jpg', alt: 'Creating and managing remote vaults in the English OWiki console' } },
        { id: 'connect', title: '3. Install the plugin and confirm the destination', steps: ['Find OWiki Sync in Obsidian community plugins and enable it. If the listing is unavailable, manually install main.js, manifest.json, and styles.css from a plugin release.', 'In the intended local vault, enter the complete ws://…/ws or wss://…/ws address, sync token, and remote vault name in plugin settings. Alternatively, use One-click authorize in the web vault settings.', 'Click Connect, check the local and remote vaults in the confirmation dialog, then approve syncing. The current flow authenticates with the token and registers the device; no device PIN is required.', 'Wait for reconciliation to finish. Create a test note in Obsidian and find it in the web console. Edit it on the web and check Obsidian, then test an image attachment.'], notice: 'Validate before connecting important notes or a second device. Deletions and renames propagate too, so only experiment with disposable files.', links: [{ label: 'Download OWiki Sync', href: `${pluginRepo}/releases` }] },
      ],
    },
    {
      slug: 'docker', group: 'Deployment & operations', title: 'Docker deployment',
      description: 'Use Docker Compose for long-term hosting, or a single Docker command for a quick start.',
      sections: [
        { id: 'compose', title: 'Docker Compose (recommended)', paragraphs: ['Install Docker with the Compose plugin and save the following as compose.yaml. Replace replace-with-your-strong-password with your own strong password before starting. No source checkout or additional configuration file is needed.', 'SQLite and attachments persist in owiki-data beside this file. Choose Compose or docker run, never two instances using the same data directory.'], code: { language: 'yaml', value: compose }, notice: 'This exposes host port 8787: use a trusted LAN and restrict access with a firewall; configure HTTPS before internet access. compose.yaml contains a plaintext password: do not commit or share it.' },
        { id: 'compose-start', title: 'Start the Compose service', paragraphs: ['Run this from the directory containing compose.yaml, then open http://localhost:8787 and sign in as admin with your chosen password. On other devices, use the secure server address.'], code: { language: 'bash', value: 'docker compose up -d' }, notice: 'Do not remove or empty owiki-data, or use docker compose down -v as a routine upgrade step.' },
        { id: 'run', title: 'Alternative: a single container', paragraphs: ['If you prefer not to use Compose, run the command below. Replace replace-with-your-strong-password with your own strong password first. Data persists in owiki-data under the current directory.', 'Use this only to create a new container, not alongside the Compose instance above. The password is visible in shell history and Docker environment settings; do not share them.'], code: { language: 'bash', value: dockerStart } },
        { id: 'image', title: 'Choose an image and version', paragraphs: ['The official image repositories are johnhom1024/owiki and docker.cnb.cool/johnhom1024/owiki. The CNB mirror is an alternative for networks with limited Docker Hub access; use the same actual release tag.', 'Image tags match Git release tags without the leading v. latest moves with stable releases; prereleases have explicit -beta.N tags. Pin a tested version or digest for production and change it deliberately during upgrades.', 'The repository release workflow currently builds linux/amd64. On ARM hosts, inspect the target image platform before deploying; do not assume a native arm64 build is available.'], links: [{ label: 'Image and version policy', href: `${serverRepo}/blob/main/docs/versioning.md` }, { label: 'Docker Hub', href: 'https://hub.docker.com/r/johnhom1024/owiki' }] },

        { id: 'proxy', title: 'Reverse proxy and HTTPS', paragraphs: ['The service listens on :8787 by default and does not terminate TLS. For internet access, use a reverse proxy such as Caddy or nginx to provide HTTPS and forward the web app, /api, /openapi, /mcp, and /ws as needed. /ws must support WebSocket Upgrade and long-lived connections.', 'The examples expose host port 8787. With a proxy running directly on the same host, change the mapping to 127.0.0.1:8787:8787 to avoid exposing the backend directly. A containerized proxy should normally share a Docker network and reach OWiki by service name on port 8787, not by the host loopback address.', 'For an HTTPS domain, configure the plugin with wss://your-domain/ws. Forward the correct Host and X-Forwarded-Proto so generated authorization links do not contain an internal hostname or ws://. Do not expose trusted proxy-header handling directly to untrusted traffic.'] },
        { id: 'verify', title: 'Verify the deployment', paragraphs: ['The health endpoint returns status, clients, and version. A healthy process is only the first check: also verify login, attachment access, and a real device sync.'], code: { language: 'bash', value: health } },
      ],
    },
    {
      slug: 'development', group: 'Deployment & operations', title: 'Local development',
      description: 'For source changes only; use Docker or Docker Compose to deploy the service.',
      sections: [
        { id: 'prerequisites', title: 'Development prerequisites', paragraphs: ['Install Git, Make, Go 1.26.7 or later (see go.mod), plus Node.js and pnpm 11.15.0 (see web/package.json). Node.js 24 LTS is recommended; web/package.json does not declare a separate Node engines requirement.'], links: [{ label: 'Docker deployment', href: '?page=docker#compose' }] },
        { id: 'clone', title: '1. Clone and prepare configuration', code: { language: 'bash', value: developmentSetup } },
        { id: 'password', title: '2. Edit the administrator password', paragraphs: ['Open .env in your editor, replace OWIKI_ADMIN_PASSWORD with your own strong password, and save. Do not use the sample password or commit or share .env. This password only applies when the administrator is first initialized.'] },
        { id: 'start', title: '3. Start the development environment', paragraphs: ['Run make dev from the owiki directory. It starts the backend on 8787 and the frontend development server on 5174, automatically installing and building the web app when dependencies or build output are missing.', 'Open http://localhost:5174 and sign in as admin with the password you just set. This environment is for local testing, not direct internet exposure.'], code: { language: 'bash', value: 'make dev' } },
      ],
    },
    {
      slug: 'configuration', group: 'Deployment & operations', title: 'Configuration & credentials',
      description: 'Understand first-run settings, storage paths, and the three distinct credential types.',
      sections: [
        { id: 'environment', title: 'Server environment variables', paragraphs: ['OWIKI_ADDR is the listen address, default :8787. OWIKI_DB is the SQLite path: owiki.db when running directly, or /data/owiki.db in the official container.', 'OWIKI_ATTACH_DIR defaults to attachments beside the database. If you move it outside /data, persist and back it up separately.', 'OWIKI_ADMIN_USER is the initial username, default admin. OWIKI_ADMIN_PASSWORD is the initial password; if it is empty and no administrator exists, no account is created.', 'OWIKI_TOKEN only migrates legacy notes with vault_id=0 into a default vault. Fresh deployments do not need it: create vaults in the web console and use their individual tokens. Never reuse the development token or sample password from .env.example.', 'Local source runs load .env without overriding existing process environment variables. In production containers, pass configuration through --env-file or Compose.'] },
        { id: 'admin', title: 'Administrator account: the web console', paragraphs: ['The administrator username and password create a web session for managing vaults, devices, feature switches, and API keys. Administrators can access server-side notes. Do not give this account to a script that only needs to read one vault.', 'Accounts persist in SQLite. Changing OWIKI_ADMIN_USER or OWIKI_ADMIN_PASSWORD after initialization does not replace an existing account and is not a password reset procedure. Do not delete the database to reset a password. Web account security settings support TOTP two-factor authentication.'] },
        { id: 'sync-token', title: 'Sync token: Obsidian connections', paragraphs: ['Get the vault-specific sync token from that vault’s settings. The plugin uses it to locate and authenticate the remote vault, then registers its device identity. The remote vault name is a destination check, not another secret. There is no additional PIN-pairing step in the current implementation.', 'One-click authorization links also carry credentials. Treat them as passwords: do not publish them in screenshots, chat, or issue reports. A device name is just a label, not an access key.', 'Rotating a token alone is not the same as closing existing connections immediately. If a token leaks, use the vault-wide revoke authorization action: it clears devices, rotates the token, and disconnects current vault connections. Reauthorize trusted devices afterward.'] },
        { id: 'api-keys', title: 'API keys: scripts and AI', paragraphs: ['Create these on the web API keys page. REST /openapi/* and MCP /mcp share this credential type. Keys can be limited to selected vaults and read-only access; the server stores API key SHA-256 hashes.', 'REST accepts X-API-Key or Bearer authentication; MCP can use X-API-Key. Prefer headers over URL parameters to avoid leaking credentials through browser history, proxy logs, or copied links.', 'Administrator passwords, vault sync tokens, and API keys are not interchangeable. Issue a separate least-privilege key to each integration and revoke it when no longer needed.'], links: [{ label: 'REST, MCP, and Agent Skill reference', href: `${serverRepo}/blob/main/docs/openapi-skill.md` }] },
        { id: 'features', title: 'Built-in feature switches', paragraphs: ['OWIKI_SHARE, OWIKI_SYNCLOG, OWIKI_APIKEYS, and OWIKI_MCP set defaults when no saved setting exists: empty means enabled, off means disabled. Use Settings → Plugins for routine changes; saved web settings take precedence over environment defaults.', 'Disabling a feature hides its UI and restricts the corresponding endpoints without deleting its data. Disabling sharing also makes existing public links unavailable. Recheck old links when enabling it again, because their records remain.'] },
      ],
    },
    {
      slug: 'maintenance', group: 'Deployment & operations', title: 'Backup & maintenance',
      description: 'Back up both SQLite and attachments, and prepare a tested recovery path before upgrading.',
      sections: [
        { id: 'backup', title: 'Back up the complete data set', paragraphs: ['The default Docker data directory contains owiki.db and attachments, and may contain SQLite -wal / -shm files. Copying only a live database file can produce an inconsistent backup; a database-only backup also omits binary attachment contents.', 'The simplest maintenance-window backup is to pause writes, stop OWiki, copy the complete owiki-data directory to independent storage, then restart. Include any custom OWIKI_ATTACH_DIR. Preserve permissions, record the image version and deployment configuration, and encrypt or separately secure copies of credential files.'], steps: ['Ask users to pause Obsidian, web, and automation writes.', 'Run docker stop owiki, confirm it stopped, and create a dated copy or snapshot of the entire data directory.', 'Run docker start owiki and check health, login, and a test note.', 'Regularly restore a backup in an isolated environment and open both a note and an attachment. Retain multiple backup generations.'], notice: 'Do not connect production devices to a test restoration. Sync propagates deletions and mistakes, so keep an independent local vault backup too.' },
        { id: 'upgrade', title: 'Upgrade deliberately', steps: ['Read the target release notes and record the current image tag or digest, plugin version, and storage paths. Protocols and APIs may change during the 0.x phase.', 'Take a complete backup. Prefer testing the new server and plugin combination in a separate instance first.', 'For Compose, change the image tag in compose.yaml, run docker compose pull, then docker compose up -d. For docker run, stop and replace the container while retaining the same persistent mount and configuration.', 'Check version at /api/health, then test login, web editing, plugin reconnection, and attachment downloads before resuming normal writes.'], links: [{ label: 'Server releases', href: `${serverRepo}/releases` }, { label: 'Plugin releases', href: `${pluginRepo}/releases` }] },
        { id: 'rollback', title: 'Rollback may require restoring data', paragraphs: ['An older image may not understand a database migrated by a newer release. Do not repeatedly experiment with different versions against your only production data copy. Stop writes and preserve the current state first; if needed, restore the complete pre-upgrade backup together with its matching image.', 'Restoring a snapshot discards later server-side changes. Back up current device files before reconnecting, and plan how to reconcile them with the restored vault instead of immediately triggering uncontrolled bidirectional sync.'] },
        { id: 'diagnostics', title: 'Routine checks and useful evidence', paragraphs: ['Monitor free disk space, data directory permissions, container restarts, and proxy errors. Server logs and plugin Diagnostics help identify connection state and both component versions.', 'When sync logs are enabled, vault settings show changes, deletions, and conflicts. The current daily cleanup retains roughly 30 days and at most 5,000 entries per vault. This is not unlimited history or a restorable revision archive.', 'When reporting problems, include both versions, redacted logs, timestamps, the sequence of actions, other sync tools in use, and a minimal reproduction. Remove tokens, API keys, administrator details, and private note text.'], code: { language: 'bash', value: health }, links: [{ label: 'Report an issue', href: `${serverRepo}/issues` }, { label: 'Security reporting', href: `${serverRepo}/blob/main/SECURITY.md` }] },
      ],
    },
    {
      slug: 'plugin', group: 'User guides', title: 'Obsidian plugin',
      description: 'Install OWiki Sync, authorize each device correctly, and understand its connection states.',
      sections: [
        { id: 'install', title: 'Install and update', paragraphs: ['Find OWiki Sync under Obsidian Settings → Community plugins, install it, and enable it. If the listing is unavailable, install manually or add johnhom1024/owiki-sync through BRAT. The current source requires Obsidian 1.13.0 or later and is not desktop-only.'], steps: ['For manual installation, download main.js, manifest.json, and styles.css from the same plugin release.', 'Place all three in the target vault’s .obsidian/plugins/owiki-sync/ directory. If you use a custom Obsidian configuration directory, substitute that configDir.', 'Reload the plugin list and enable OWiki Sync. Back up the vault and read release notes before updating.'], links: [{ label: 'Plugin downloads', href: `${pluginRepo}/releases` }, { label: 'BRAT', href: 'https://github.com/TfTHacker/obsidian42-brat' }] },
        { id: 'pair', title: 'Enter connection details and confirm', paragraphs: ['Copy the WebSocket address and sync token from the remote vault’s web settings. Manual connection also requires the remote vault name. Your local folder can have a different name, but verify that these are the two vaults you intend to connect.', 'One-click authorize opens Obsidian with the connection details and still requires confirmation. Open the intended local vault first, especially when you use several vaults. The server registers the device after successful authentication; there is no PIN to generate or enter.'], image: { src: 'screenshots/plugin-settings-en.jpg', alt: 'OWiki Sync English settings showing connection, device, sync, and diagnostics' }, code: { language: 'text', value: 'Local test: ws://localhost:8787/ws\nHTTPS domain: wss://notes.example.com/ws\nAlso required: vault sync token + remote vault name' } },
        { id: 'controls', title: 'Sync controls and device identity', paragraphs: ['Auto sync is enabled by default and batches local edits with an approximately two-second debounce. Sync now sends a fresh inventory and transfers differences. Refresh authorization reconnects to check the current token; it does not rotate the token.', 'The auto-sync toggle controls automatic local event uploads, not all network activity. The connection and incoming remote messages may remain active. To isolate a vault for repair, disconnect or disable the plugin and stop other writers first.', 'After changing the device name, click Save to reconnect and publish the new name. Device identity lives in device-local storage so copying plugin settings does not make multiple devices share an ID. Do not clone identities to connect a new device.'] },
        { id: 'states', title: 'Connected, observing, and disconnecting', paragraphs: ['Connecting means the transport is not ready yet. For authentication failures, verify the token and destination. Connected does not mean reconciliation is complete. Mobile operating systems may suspend background activity, so do not assume an app in the background remains online.', 'Connected, not the sync device means single-device sync is enabled and this device is not selected. It keeps its connection and heartbeat but neither uploads file changes nor receives file-change broadcasts. Select it in the web vault settings or disable single-device mode.', 'The plugin’s danger-zone disconnect and deauthorize action releases this device connection without deleting local notes. If a token has leaked, revoke the entire vault’s authorization in the web console and issue new credentials rather than relying on a local disconnect.'] },
      ],
    },
    {
      slug: 'sync', group: 'User guides', title: 'Sync & conflicts',
      description: 'Understand reconciliation, live updates, and conflict-copy limits before trusting multi-device edits.',
      sections: [
        { id: 'reconcile', title: 'Compare inventories, then transfer differences', paragraphs: ['The plugin sends hello over /ws with the vault sync token and device identity. After authentication and confirmation, if sync is allowed, hashlist reports paths, hashes, and modification times. The server returns differences, and the client uploads content or downloads it with fetch.', 'Files with matching content hashes do not need their bodies transferred again. Inventories and heartbeats still use bandwidth. Incremental means changed-file transfer, not zero network traffic or character-level patches.', 'Initial sync is not a server-only restore: local files can be uploaded too. Because both sides participate, do not connect two vaults with unknown contents and assume one side will win safely.'] },
        { id: 'scope', title: 'What is included', paragraphs: [`The current plugin syncs Markdown (.md) and these attachment extensions: ${attachments}. Do not assume arbitrary file formats, audio, video, or the entire configuration directory are supported.`, 'The reconciliation scan excludes the Obsidian configuration directory and .conflict.md copies. OWiki is not a .obsidian configuration sync tool; manage plugins, themes, shortcuts, and workspace settings separately.', 'While online, local creates and edits upload content; deletes and renames also reach the server and other sync-enabled devices. A remote deletion can affect local files, so another connected device is not an immutable backup.'] },
        { id: 'offline', title: 'Reconnects and single-device mode', paragraphs: ['The client reconnects with exponential backoff, capped at about 30 seconds, and reconciles after authentication. Local files remain the basis of offline editing. Pending uploads and message queues are not a complete crash-persistent operation log, so do not assume every offline operation is guaranteed to survive.', 'Single-device mode allows only the selected plugin device to exchange files. Other devices can connect and register but cannot upload, fetch, or receive file broadcasts. They are not read-only live mirrors, and the mode is not a global lock on web or API writes. When eligibility returns, the client reconciles again.', 'Do not let every device exchange the same files through both iCloud and OWiki. Existing iCloud users should follow the single-device setup below and validate it on a test vault. Do not stack additional bidirectional channels such as Obsidian Sync on top.'] },
        {
          id: 'icloud', title: 'Using iCloud: configure single-device sync',
          paragraphs: ['If your Mac, iPhone, and iPad already share an Obsidian vault through iCloud, they do not all need to sync it through OWiki as well. Keep iCloud responsible for file sync between Apple devices, and select one regularly available Mac that can keep Obsidian running as the device connecting to OWiki.', 'The path is: iPhone / iPad ↔ iCloud ↔ selected Mac (OWiki Sync) ↔ OWiki server. This remains bidirectional, not upload-only: web or API edits reach the selected Mac first, then travel through iCloud to your other Apple devices.'],
          steps: ['Back up the entire vault, pause edits, and wait for iCloud to finish syncing notes and attachments. Ensure files on the selected Mac are downloaded locally rather than cloud placeholders. Validate with a test vault first.', 'Initially configure OWiki Sync only in the intended vault on the selected Mac. Connect to the correct remote vault and confirm the destination. Do not connect other devices to OWiki before single-device mode is enabled.', 'Open the OWiki web console → the remote vault’s settings → authorized devices and Single-device sync. At least one device must have connected and registered before the switch becomes available.', 'Enable Single-device sync and check the device named in the confirmation dialog before confirming. The initial selection may be the most recently online device, not your intended Mac.', 'Under Device that syncs, select that Mac, matching its name and device ID, then confirm the change. Keep Obsidian, OWiki Sync, and automatic sync enabled on it.', 'Other Apple devices can continue using iCloud without connecting to OWiki. If their plugins are already connected, they will show connected but not the sync device. This observing state is normal: they do not upload, download, or receive file updates through OWiki; iCloud still updates their files.', 'Verify the whole path: create a disposable note on your iPhone, wait for iCloud to deliver it to the selected Mac, then check the web console. Edit it on the web and verify the Mac and iPhone. Repeat with a test image attachment.'],
          notice: 'If the selected Mac is shut down, asleep, running without Obsidian, or disconnected, iCloud can still sync between Apple devices, but OWiki does not receive iCloud changes directly and does not automatically select another device. Single-device mode is not a backup and cannot eliminate iCloud conflicts. Avoid concurrent edits to the same note.',
          links: [{ label: 'Plugin connection states', href: '?page=plugin#states' }, { label: 'Backup and recovery', href: '?page=maintenance#backup' }],
        },
        {
          id: 'icloud-switch', title: 'Switch the selected device in an iCloud setup',
          paragraphs: ['Before handing over to another Mac, pause device, web, and API writes. Wait for iCloud to finish syncing between the old and new devices, back up, and verify that notes and attachments are fully downloaded on the new Mac. Do not disable single-device mode just to temporarily allow every device to sync.', 'Leave single-device mode enabled. Connect and register the new device, which may initially be observing. Select it under Device that syncs in the web console and confirm. The old device loses sync eligibility; once the new device becomes eligible and reconciles, repeat the bidirectional test. Changing the selection does not download missing iCloud files for you.'],
        },
        { id: 'conflicts', title: 'Resolve a conflict carefully', paragraphs: ['The server uses the client’s last synced baseHash and an available snapshot to attempt a three-way merge. Clean merges are saved; otherwise the plugin receives a conflict. This is not a promise to preserve unlimited history under all conditions.', 'For a Markdown conflict, the plugin keeps the current local note and saves the server’s content beside it as name.conflict.md. These copies do not sync onward. An existing conflict copy at that path may be updated, so independently preserve both versions before continuing.'], steps: ['Pause edits to the note on other devices and back up the original plus the conflict copy.', 'Compare them side by side and put the content you want to keep into the original note.', 'Save the original to retry uploading, then check the web console and other devices.', 'Remove the conflict copy manually only after verifying that all needed content is retained.'], notice: 'Conflict copies are not revision history. Binary attachments do not follow Markdown three-way text merge semantics. Do not rely on absolute “never overwrites” guarantees.' },
      ],
    },
    {
      slug: 'web', group: 'User guides', title: 'Web library & sharing',
      description: 'Read, edit, manage, and share notes in a browser while keeping automation access scoped.',
      sections: [
        { id: 'library', title: 'Your notes in a browser', paragraphs: ['Sign in to your server with an administrator account and enter a vault from the home page. The web console shows data already received by the server, not a live view of a computer’s local folder. Offline local edits appear only after a successful upload.', 'Browse files, read and edit notes, or create Markdown notes. Web writes are saved by the same service and broadcast to sync-enabled Obsidian devices. A mobile browser can access the library without installing Obsidian on that device.'], image: { src: 'screenshots/home-en.jpg', alt: 'OWiki English web home with remote vault overview' } },
        { id: 'vault-settings', title: 'Manage vaults and devices', paragraphs: ['Vault settings bring together sync tokens, one-click authorization, device status, single-device sync, and sync logs. Authorized does not necessarily mean exchanging files: consider whether a device is offline or observing.', 'Deleting a remote vault is destructive: it clears that vault’s server-side notes, device records, and related data. It is not equivalent to signing out or disconnecting one device. Back up first and verify the vault you are deleting.'] },
        { id: 'share', title: 'Share one note publicly', paragraphs: ['With sharing enabled, create a public link from a note’s detail view and optionally send its QR code. Recipients do not need an administrator account. Treat the link as permission to access the page; check the text, embedded images, and sensitive information before sharing.', 'Revoke a link when it is no longer needed. Turning off sharing globally makes existing links unavailable without deleting their records; review old links when enabling it again. Revocation cannot retrieve copies that recipients already saved.'], image: { src: 'screenshots/share-en.jpg', alt: 'OWiki public article sharing page in English' } },
        { id: 'integrations', title: 'Connect scripts or AI assistants', paragraphs: ['Enable the required API key and MCP features in Settings → Plugins, then issue a vault-scoped key on the API keys page. Validate retrieval with read-only permissions before granting writes.', 'REST lives at /openapi/* and MCP at /mcp. The web console’s /api/* endpoints use administrator sessions and are not a substitute for the integration API. API writes also propagate to Obsidian; back up before bulk organization.'], code: { language: 'bash', value: `# OWIKI_API_KEY is supplied securely by your environment\ncurl --fail --show-error \\\n  -H "X-API-Key: $OWIKI_API_KEY" \\\n  https://notes.example.com/openapi/vaults` }, links: [{ label: 'Complete AI integration reference', href: `${serverRepo}/blob/main/docs/openapi-skill.md` }] },
      ],
    },
    {
      slug: 'faq', group: 'Reference', title: 'Frequently asked questions',
      description: 'Troubleshoot connections, authorization, missing files, and common deployment misunderstandings.',
      sections: [
        { id: 'cannot-connect', title: 'The web console works. Why will the plugin not connect?', paragraphs: ['The plugin requires a complete WebSocket URL, not the web page URL: ws://localhost:8787/ws for local tests or wss://your-domain/ws for HTTPS. Check /ws Upgrade forwarding, certificate trust on the device, and firewall access.', 'localhost on a phone or another computer is not the server. The Docker examples expose host port 8787; on other devices, use the server address on a trusted LAN or an HTTPS proxy domain, and check the firewall. Check /api/health, then plugin diagnostics and proxy logs.'] },
        { id: 'auth', title: 'Where is the PIN? Why did changing the environment password do nothing?', paragraphs: ['The current code authenticates with a vault sync token and registers the device automatically; there is no PIN. Manual plugin setup needs the WebSocket URL, sync token, and remote vault name, followed by confirmation. Older README references to PIN pairing do not describe the current flow.', 'Administrator environment variables initialize an account only when none exists. Restarting does not overwrite accounts in an existing database. Get sync tokens from vault settings and API keys from the separate key-management page; these credentials are not interchangeable.'] },
        { id: 'no-sync', title: 'Connected, but no files are syncing?', paragraphs: ['Check whether the device is observing because it is not the selected sync device. In that state it neither uploads nor receives file broadcasts. Select this device in the web vault settings or turn off single-device mode.', 'Next check auto sync, whether you completed the initial confirmation, the remote vault destination, and supported file types. Use Sync now and watch progress and logs. On mobile, return to the foreground and allow reconnection before judging the result.'] },
        { id: 'missing-files', title: 'Where are my themes, Canvas files, audio, or attachments?', paragraphs: [`The current scope is .md plus these attachments: ${attachments}. The configuration directory, .conflict.md, and unsupported extensions are not part of a full-vault sync promise. For example, .canvas, .base, audio, and video are not included like ordinary Markdown in the current inventory.`, 'If note text is present but images are missing, check the format, whether the upload succeeded, and whether you copied attachments during migration. SQLite alone does not contain binary attachment bodies.'] },
        { id: 'duplicates', title: 'What should I do with conflict copies or “file 2.md”?', paragraphs: ['Back up the original and copies first, and pause further edits to that file across devices. Check for iCloud or another bidirectional sync tool, multiple Obsidian instances opening the same vault, and duplicate-device warnings in server logs.', '.conflict.md contains the remote version for manual comparison and is not uploaded automatically. Merge needed content into the original, verify the result, and only then clean up. Deleting a copy alone does not resolve the underlying disagreement.'] },
        { id: 'security-and-backup', title: 'Can I expose OWiki publicly? Does sync replace backups?', paragraphs: ['Before exposing it, configure a strong administrator password, HTTPS, and least-privilege API keys. Protect sync tokens and one-click authorization links. The server can read note contents; self-hosting does not mean end-to-end encryption.', 'Sync cannot replace backups: deletions, mistakes, and failures can propagate. Keep an independent vault copy, back up the complete server data directory, and rehearse restoration before upgrades. OWiki remains experimental.'] },
        { id: 'report', title: 'Still need help?', paragraphs: ['Collect server, plugin, and Obsidian versions, deployment details, timestamps, and redacted logs. Reproduce with a small vault containing no private content. Never attach tokens, authorization URLs, API keys, passwords, or database files. Report vulnerabilities privately using SECURITY.md.'], links: [{ label: 'Server issues', href: `${serverRepo}/issues` }, { label: 'Plugin issues', href: `${pluginRepo}/issues` }, { label: 'Security reporting', href: `${serverRepo}/blob/main/SECURITY.md` }] },
      ],
    },
  ],
}
