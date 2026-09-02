# Security Policy

## 支持的版本

| 版本 | 支持状态 |
| --- | --- |
| latest（最新 tag） | ✅ 支持 |
| 更早版本 | ❌ 请升级后评估 |

OWiki 处于 `0.x` 早期阶段，只修复最新发布版本中的安全问题。

## 报告漏洞

**请勿通过公开 Issue 报告安全漏洞。**

请通过 [GitHub Security Advisories](https://github.com/johnhom1024/owiki/security/advisories/new) 提交，
或联系 [@johnhom1024](https://github.com/johnhom1024)。请在报告中包含：

- 问题类型（如认证绕过、路径穿越、SQL 注入、XSS）
- 复现步骤 / PoC
- 影响的版本号（`/api/health` 的 `version` 字段）
- 期望的修复时间线（如无可留空）

收到报告后 72 小时内确认，修复后会在 Release Notes 中致谢（除非你希望匿名）。

## 部署安全基线

- 修改默认 `OWIKI_ADMIN_PASSWORD`；各 vault 同步令牌在 Web 端生成，勿复用
- 服务自身不提供 TLS，置于反向代理（caddy / nginx / traefik）之后
- `/openapi/*` 密钥与 `/ws` 令牌权限独立，按需发放、及时吊销
- 同步内容明文存于 SQLite，敏感库请考虑磁盘加密
