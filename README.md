# OWiki

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/johnhom1024/owiki.svg)](https://hub.docker.com/r/johnhom1024/owiki)
[![Release](https://img.shields.io/github/v/release/johnhom1024/owiki?sort=semver)](https://github.com/johnhom1024/owiki/releases)

自部署的 Obsidian 笔记同步服务端。单二进制 + SQLite，WebSocket 实时同步。

> **组成**：本仓库为服务端（Go）+ Web 管理端（`web/`）+ 官网（`site/`）。
> Obsidian 插件：[johnhom1024/owiki-sync](https://github.com/johnhom1024/owiki-sync)（独立仓库，可上架社区市场）。
>
> 简体中文 | [English](README.en.md)

## 快速开始（Docker）

```bash
# Docker Hub
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<同步令牌> \
  -e OWIKI_ADMIN_PASSWORD=<强密码> \
  -v ./owiki-data:/data \
  johnhom1024/owiki:latest

# 国内镜像源（CNB 制品库，免登录拉取）
# docker run -d --name owiki -p 8787:8787 \
#   -e OWIKI_TOKEN=... -e OWIKI_ADMIN_PASSWORD=... -v ./owiki-data:/data \
#   docker.cnb.cool/johnhom1024/owiki:latest
```

浏览器打开 `http://localhost:8787` 进入 Web 管理端：创建 vault、生成同步令牌，再安装 [Obsidian 插件](https://github.com/johnhom1024/owiki-sync) 完成配置。

**版本固定**：生产建议用版本号 tag（如 `johnhom1024/owiki:0.0.1`）而非 `latest`，随时可回退。完整版本策略见 [docs/versioning.md](docs/versioning.md)。

## 架构

```
Obsidian 插件 (TS)  ←──WebSocket(JSON 帧)──→  OWiki (Go)
                                            ├── /ws        同步端点（哈希对账+传输+广播）
                                            ├── /api/*     Web API（列表/正文/保存/统计/SSE）
                                            ├── /openapi/* 开放接口（AI agent 用，X-API-Key 认证）
                                            └── /          Web 前端（嵌入二进制的 SPA）
```

**Web 端**（浏览器打开 `http://localhost:8787/`）：文件列表（搜索/排序/大小/时间）、
Markdown 查看/编辑。保存走 `PUT /api/files/:id`（带 `baseHash` 乐观锁），成功后
通过 Hub 广播 `changed`，Obsidian 插件自动拉回。`go:embed` 嵌进单个二进制。

**同步与冲突**：

- 每文件 SHA-256 内容哈希，**清单对账**（hashlist）找差异
- 写入带 `baseHash`（乐观锁）；能按行三方合并则静默合成，合不了返回 `conflict`
- Web 冲突三按钮：覆盖远程 / 用远程 / 插入 `<<<<<<<` 标记手工改
- 插件冲突：本地文件不动，远程另存 `xxx.conflict.md`
- upload / HTTP 保存后广播 `changed`；30s 心跳 + 读写超时清理死连接
- `rename` / `delete` 为一等消息：服务端改 path 或删记录，广播 `renamed` / `deleted`

## 项目结构

```
owiki/
├── main.go                  # 入口：组装 repo/hub/ws/webapi + 嵌入 Web 前端
├── internal/
│   ├── proto/messages.go    # 消息协议定义（所有 JSON 帧的类型）
│   ├── model/note.go        # Note 模型（path 唯一索引 + snapshot 祖先）
│   ├── merge/               # 行级三方合并
│   ├── service/note_save.go # 乐观锁 + 合并 + upsert（WS/HTTP 共用）
│   ├── repository/          # SQLite 存储（GORM + 纯 Go 驱动）
│   ├── hub/hub.go           # 连接管理器：注册/注销/广播（RWMutex 保护）
│   ├── ws/server.go         # WS 端点：readPump/writePump + 消息分发
│   └── webapi/              # Web API（GET/PUT /api/files）
├── web/                     # Web 前端源码（React+Vite+Tailwind，构建产物被 embed）
├── site/                    # 官网源码（中英双语宣传页）
└── cmd/testclient/          # 模拟插件客户端的协议端到端测试
```

## 消息协议

| 方向 | type | 说明 |
|---|---|---|
| C→S | `hello` | 认证 `{token}` → 返回 `welcome {ok}` |
| C→S | `hashlist` | 上报本地清单 `[{path,hash,mtime}]` → 返回 `hashlist_response {diffs:[{path,action}]}` |
| C→S | `upload` | `{path,hash,content,mtime}` → `ok` + 广播 `changed` |
| C→S | `fetch` | `{path}` → `fetch_response {content,...}` |
| S→C | `changed` | 其他连接上传了 `{path,hash}` → 客户端按需 fetch |
| S→C | `ping` | 30s 心跳，客户端回 `pong`（或忽略，靠读超时判活） |

diff action：`upload`（客户端上传）/ `download`（客户端拉取）。

## 快速开始

```bash
make run            # :8787，默认 token: dev-token-change-me
make test-client    # 另一个终端：跑完整协议流程验证

# 自定义配置
OWIKI_ADDR=:8787 OWIKI_DB=owiki.db OWIKI_TOKEN=my-secret make run

# Web 管理端登录账户（首次启动时初始化，已存在则不覆盖）
OWIKI_ADMIN_USER=admin OWIKI_ADMIN_PASSWORD=强密码 make run
```

## 验证过的场景（testclient 覆盖）

- 错误 token 被拒 / 正确 token 通过
- A 上传 → B 秒收 changed 广播 → B fetch 拿到内容
- 双端一致后对账 diffs 为空（零传输）
- 内容与哈希不符的上传被服务端完整性校验拒绝
- 新空客户端对账 → 全部标记 download（冷启动拉全量）

## 安全提示

- Web 管理端需登录（cookie session，7 天有效期）：除 `/api/health`、`/api/auth/*` 外全部 `/api/*` 要求登录
- 管理员账户由 `OWIKI_ADMIN_USER` / `OWIKI_ADMIN_PASSWORD` 在首次启动时初始化；改环境变量不会覆盖已有账户
- `/openapi/*` 走 X-API-Key 认证，`/ws` 走 vault token 认证，两者不受登录影响
- 生产务必改 `OWIKI_TOKEN` 和管理员密码
- MVP 未上 TLS，建议置于反向代理（caddy/nginx）之后

## 已知边界情况

- **路径大小写**：Obsidian/macOS(APFS) 文件夹不区分大小写（`AI/` 与 `ai/` 是同一目录，
  保留首次创建的写法）；而 OWiki 服务端（SQLite + Linux NAS）路径匹配区分大小写。
  单一 macOS 设备同步无影响；但混用不同大小写的路径字符串可能在服务端产生
  重复记录（`AI/x.md` 与 `ai/x.md` 视为两篇）。在 Obsidian 里做大小写重命名是安全的
  （走 rename 消息）。多设备且文件系统大小写敏感性不一致时需注意。
  暂不做服务端折叠校验，保持现状。

## 开放接口（给 AI agent 调用）

`/openapi/*` 是给 AI/外部脚本的 REST API：新建/读取/更新/删除/搜索笔记，
写入实时广播到 Obsidian。认证用 API 密钥（Web 端侧边栏「API 密钥」页生成，
明文只显示一次，库存 SHA-256）。

- **接口文档 + AI skill 说明**：[docs/openapi-skill.md](docs/openapi-skill.md)
- 快速试用：

```bash
KEY=owk_xxx  # Web 管理页生成
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults
curl -s -X POST "http://localhost:8787/openapi/vaults/1/notes/AI/新文章.md" \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"content": "# 由 AI 创建\n\n内容..."}'
```

配套的 agent skill 源文件在 `~/.dsh/skills/owiki/SKILL.md`（DSH 技能目录，
内容与 docs/openapi-skill.md 相同，更新时两边同步）。

## 从源码构建

```bash
git clone https://github.com/johnhom1024/owiki
cd owiki
make run          # :8787，默认 token: dev-token-change-me
make test-client  # 另一个终端：完整协议流程验证
```

开发说明：`web/`（React 管理端）改样式用 `make web-dev`（:5174 热更）；插件开发在 [owiki-sync](https://github.com/johnhom1024/owiki-sync) 仓库。

## 参与贡献

欢迎 Issue / PR。提交前请跑 `go test ./... && go vet ./...`；前端改动跑 `web/` 下的 `pnpm build` 确认无类型错误。发版流程见 [docs/versioning.md](docs/versioning.md)。

## 安全

- 生产务必改 `OWIKI_TOKEN` 与管理员密码
- 服务默认无 TLS，置于反向代理（caddy/nginx）之后
- 报告安全漏洞请勿开公开 Issue，见 [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 johnhom
