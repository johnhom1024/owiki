---
name: owiki
description: "调用 owiki 自部署笔记同步服务的开放 REST API（/openapi/*）或 MCP（/mcp），管理 Obsidian 笔记库：新建/读取/更新/删除/搜索文章。当用户要求把内容写入笔记、保存到 Obsidian、查笔记、在 owiki 上创建文章、或维护 owiki 服务器时使用。需要 API 密钥（X-API-Key 或 Bearer）。有 MCP 的客户端可直接连 /mcp，无需读本文档。"
---

# owiki — 自部署笔记同步服务开放 API

## 服务信息

| 项 | 值 |
| --- | --- |
| 生产地址 | `http://your-server:8787`（NAS 部署） |
| 本地开发 | `http://localhost:8787` |
| 协议 | REST + JSON；写操作实时广播到 Obsidian（插件自动拉取落盘）。有 MCP 的客户端可直接连 `/mcp`，工具 schema 自描述 |
| 认证 | 请求头 `X-API-Key: owk_xxx` 或 `Authorization: Bearer owk_xxx`；MCP 也接受 `?key=owk_xxx` |

## 获取 API 密钥

密钥在 Web 管理端生成：`http://<server>:8787` → 侧边栏「API 密钥」→ 新建。
明文只显示一次。密钥可限定 vault 范围（vaultScope=0 表示全部 vault）。

如果用户没提供密钥，先向用户要；不要猜测或尝试默认值。

## 端点速查

所有路径中的 `<vid>` 是 vault id（先 `GET /openapi/vaults` 查）。笔记路径与 Obsidian 中一致（如 `日记/2026-08.md`），URL 里需 percent-encode。

| 操作 | 方法 + 路径 | 说明 |
| --- | --- | --- |
| 列 vault | `GET /openapi/vaults` | 返回 id/name/note |
| 列笔记 | `GET /openapi/vaults/<vid>/notes` | 元数据列表；`?full=1` 带正文 |
| 读笔记 | `GET /openapi/vaults/<vid>/notes/<path>` | 含正文 content |
| 新建/更新 | `POST /openapi/vaults/<vid>/notes/<path>` | body: `{content, baseHash?, force?, mtime?}` |
| 重命名 | `PATCH /openapi/vaults/<vid>/notes/<path>` | body: `{"to": "新路径"}` |
| 删除 | `DELETE /openapi/vaults/<vid>/notes/<path>` | |
| 搜索 | `GET /openapi/vaults/<vid>/search?q=关键词` | 子串匹配 path+content，返回 snippet |

响应统一 `{data: ...}`；错误 `{error: "..."}`（401=key 无效，403=vault 不在 scope，404=不存在，409=写冲突）。

## 写入的乐观锁（防覆盖用户编辑）

POST 更新已有笔记时：
1. 先 GET 拿到当前 `contentHash`
2. 更新时带 `baseHash: <该 hash>`
3. 若期间用户在 Obsidian 改过 → 409 conflict → 读最新内容重新合并后再试，或 `force: true` 强制覆盖（慎用）
4. 新建笔记（路径不存在）不需要 baseHash

## curl 示例

```bash
# 1. 列出 vault
curl -s -H "X-API-Key: $OWIKI_KEY" http://your-server:8787/openapi/vaults

# 2. 新建文章（Obsidian 几秒内就会出现）
curl -s -X POST "http://your-server:8787/openapi/vaults/1/notes/AI/新文章.md" \
  -H "X-API-Key: $OWIKI_KEY" -H 'Content-Type: application/json' \
  -d '{"content": "# 新文章\n\n由 AI 创建。"}'

# 3. 读取
curl -s -H "X-API-Key: $OWIKI_KEY" \
  "http://your-server:8787/openapi/vaults/1/notes/AI/%E6%96%B0%E6%96%87%E7%AB%A0.md"

# 4. 带乐观锁更新
HASH=$(curl -s -H "X-API-Key: $OWIKI_KEY" "..." | jq -r .data.contentHash)
curl -s -X POST "..." -H "X-API-Key: $OWIKI_KEY" -H 'Content-Type: application/json' \
  -d "{\"content\": \"新内容\", \"baseHash\": \"$HASH\"}"

# 5. 搜索
curl -s -H "X-API-Key: $OWIKI_KEY" \
  "http://your-server:8787/openapi/vaults/1/search?q=部署方案"
```

## 行为准则

1. **写之前先读**：更新笔记必须先 GET 拿 baseHash，避免静默覆盖用户编辑
2. **路径规范**：用 vault 内相对路径（斜杠分隔），中文路径 URL-encode
3. **删除要谨慎**：先向用户确认；删除会同步删 Obsidian 本地文件
4. **Markdown 内容**：正文是 Obsidian 风格 markdown，支持 wikilink（`[[笔记名]]`）和附件嵌入（`![[图片.png]]`）
5. **附件**：图片等二进制有元数据但 content 为空；不要尝试 POST 附件内容（走 Obsidian 客户端同步）

## 常见排错

| 现象 | 原因 |
| --- | --- |
| 401 | key 无效或被删（管理页重新生成） |
| 403 vault not in key scope | key 限定了 vault，换 vault 或改 scope |
| 409 conflict | 笔记被并发修改；重新读-合并-写，或 force |
| 写入后 Obsidian 没出现 | 插件离线；重新连接后对账会补拉 |
