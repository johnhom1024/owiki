<div align="center">

<img src="docs/logo.svg" width="96" height="96" alt="OWiki">

# OWiki

自部署的 Obsidian 同步 + Wiki 服务

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/johnhom1024/owiki.svg)](https://hub.docker.com/r/johnhom1024/owiki)
[![Release](https://img.shields.io/github/v/release/johnhom1024/owiki?sort=semver)](https://github.com/johnhom1024/owiki/releases)

多端同步笔记 · 浏览器随处访问你的笔记库 · 把笔记库交给 AI 助手打理 · 数据只存在你自己的机器上

**[官网](https://johnhom1024.github.io/owiki/)** ·
**[AI 接口文档](docs/openapi-skill.md)** ·
**[快速开始](#-快速开始)** ·
**[Obsidian 插件](https://github.com/johnhom1024/owiki-sync)**

简体中文 | [English](README.en.md)

</div>

---

> [!WARNING]
> **试验性阶段提醒**：OWiki 目前处于早期试验性阶段，同步逻辑尚未经过大规模验证，不当配置或异常场景下**可能导致笔记数据丢失或损坏**。请在接入前为你的 Obsidian 仓库（vault）做好**额外备份**，并建议先在非关键库上试用。**因使用本软件造成的任何数据丢失，本项目概不负责**（详见 [MIT LICENSE](LICENSE)）。

## ✨ 特性

- **实时多端同步** —— 编辑保存 2 秒内自动推送到所有设备，断线自动重连，断线期间的变更不丢失
- **增量传输** —— 只传真正变化的文件，没改过的笔记一个字节都不走；双端一致时零流量
- **冲突不丢内容** —— 两台设备同时改一篇笔记，能自动合并的就自动合并，合不了的会另存一份副本，本地文件永不被静默覆盖
- **网页版笔记库** —— 手机、公司电脑、平板，任何浏览器打开网址就能看和编辑你的全部笔记，不用装 Obsidian
- **文章分享** —— 生成公开链接把单篇笔记分享给没有 Obsidian 的人，可附二维码
- **设备级授权** —— 每台设备独立身份，凭 PIN 授权接入，不想要了随时解绑
- **附件同步** —— 图片等二进制附件随笔记一起同步
- **AI 开放接口** —— 给你的 AI 助手喂一份 skill 文档和 API 密钥，它就能帮你写笔记、整理、查内容，写好的东西直接出现在 Obsidian 里
- **单文件数据** —— 所有数据就是一个 SQLite 文件，拷走就是备份，不锁任何私有格式

## 🚀 快速开始

三步跑起来：启动服务端 → 创建 Vault → 安装插件。

### 1. 启动服务端

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<同步令牌> \
  -e OWIKI_ADMIN_PASSWORD=<强密码> \
  -v ./owiki-data:/data \
  johnhom1024/owiki:latest
```

<details>
<summary>更多启动方式（docker-compose / 二进制 / 国内镜像源）</summary>

```yaml
# docker-compose.yaml
services:
  owiki:
    image: johnhom1024/owiki:latest
    ports:
      - '8787:8787'
    environment:
      OWIKI_DB: /data/owiki.db
      OWIKI_ADDR: ':8787'
      OWIKI_TOKEN: ${OWIKI_TOKEN}
      OWIKI_ADMIN_USER: admin
      OWIKI_ADMIN_PASSWORD: ${OWIKI_ADMIN_PASSWORD}
    volumes:
      - ./data:/data
    restart: unless-stopped
```

```bash
# 国内镜像源（CNB 制品库，免登录拉取）
docker run -d --name owiki -p 8787:8787 \
  -e OWIKI_TOKEN=... -e OWIKI_ADMIN_PASSWORD=... -v ./owiki-data:/data \
  docker.cnb.cool/johnhom1024/owiki:latest

# 从源码构建
git clone https://github.com/johnhom1024/owiki
cd owiki
make run   # :8787，默认 token: dev-token-change-me
```

</details>

> [!TIP]
> 生产环境建议用版本号 tag（如 `johnhom1024/owiki:0.0.1`）而非 `latest`，出问题能立刻回退到旧版本。版本策略见 [docs/versioning.md](docs/versioning.md)。

### 2. 创建 Vault 并授权

浏览器打开 `http://localhost:8787`，登录 Web 管理端：创建 vault、生成同步令牌与设备 PIN。

### 3. 安装 Obsidian 插件

从 [GitHub Releases](https://github.com/johnhom1024/owiki-sync/releases) 下载 `main.js`、`manifest.json`、`styles.css` 三件套，放入 vault 的插件目录后启用，填入服务器地址与同步令牌：

```
<你的库>/.obsidian/plugins/owiki-sync/
```

<details>
<summary>BRAT 安装（官方市场上架前）</summary>

安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，在其设置里 Add Beta plugin 填入 `johnhom1024/owiki-sync`，即可安装并随 GitHub Release 自动更新。

</details>

首次连接自动对账：远端有的拉下来，本地有的传上去。

## ⚙️ 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `OWIKI_TOKEN` | `dev-token-change-me` | 同步令牌，生产必改 |
| `OWIKI_ADMIN_USER` | `admin` | Web 管理端登录用户（首启初始化） |
| `OWIKI_ADMIN_PASSWORD` | 空 | Web 管理端登录密码，生产必改 |
| `OWIKI_ADDR` | `:8787` | 监听地址 |
| `OWIKI_DB` | `owiki.db` | SQLite 数据库路径 |
| `OWIKI_ATTACH_DIR` | `<DB 同目录>/attachments` | 附件存储目录 |

## 🔌 AI 开放接口

`/openapi/*` 是给 AI 助手和外部脚本的 REST API：新建、读取、更新、删除、搜索笔记，写入实时广播进 Obsidian。认证用 API 密钥（Web 端生成，SHA-256 存储）。

```bash
KEY=owk_xxx  # Web 管理端「API 密钥」页生成
curl -s -H "X-API-Key: $KEY" http://localhost:8787/openapi/vaults

curl -s -X POST "http://localhost:8787/openapi/vaults/1/notes/AI/新文章.md" \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"content": "# 由 AI 创建\n\n内容..."}'
```

完整文档与 Agent Skill 说明：[docs/openapi-skill.md](docs/openapi-skill.md)

## 📖 文档

- [官网](https://johnhom1024.github.io/owiki/) —— 功能总览与同步原理
- [AI 接口文档](docs/openapi-skill.md) —— OpenAPI 端点与 agent skill
- [版本策略](docs/versioning.md) —— 镜像 tag 与发版流程

## 🤝 参与贡献

欢迎 Issue / PR。提交前请跑 `go test ./... && go vet ./...`；前端改动跑 `web/` 下的 `pnpm build` 确认无类型错误。

## 🔒 安全

- 生产务必改 `OWIKI_TOKEN` 与管理员密码
- 服务默认无 TLS，建议置于反向代理（caddy / nginx）之后
- 报告安全漏洞请勿开公开 Issue，见 [SECURITY.md](SECURITY.md)

## 📄 License

[MIT](LICENSE) © 2026 johnhom
