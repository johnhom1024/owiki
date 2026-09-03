# 版本与镜像发布策略

OWiki 采用「版本号 tag 永久钉死 + latest 只跟正式版」的分发模式。
预发布同样钉死，没有浮动的 `:beta`。

## Tag 约定

| 层面 | 格式 | 示例 | 说明 |
| --- | --- | --- | --- |
| git tag（正式） | `v` + SemVer | `v0.0.2` | 标记一次正式发版 |
| git tag（预发布） | `v` + SemVer + `-beta.N` | `v0.0.3-beta.1` | 远程测试用，序号人手动递增 |
| 镜像 tag | 去掉 `v` 前缀 | `0.0.2` / `0.0.3-beta.1` | 与 git tag 一一对应，永久保留 |
| 滚动 tag | `latest` | — | **只**在正式发版时更新，预发布不碰 |

## 用脚本打 tag

`scripts/tag.sh` 负责列出现有 tag、算出下一个号、在本地打 tag。**不 push**——推远程必须你明确说。

```bash
./scripts/tag.sh                 # 列出正式版 / 进行中的 beta / 下一步建议
./scripts/tag.sh beta            # 基于最新正式版，提议 v0.0.3-beta.1（已有则 +1）
./scripts/tag.sh beta 0.0.3      # 指定系列
./scripts/tag.sh release         # 提议下一个正式版 v0.0.3
./scripts/tag.sh release 0.1.0   # 指定正式版号
```

脚本会先打印将要打的 tag 并询问确认，打完提示 `git push origin <tag>`。

也可以 `make tag-list` / `make tag-beta` / `make tag-release`。

## 发版流程

> 流水线在 `.github/workflows/release.yml`，push `v*` tag 触发，构建 linux/amd64 单架构（NAS x86 部署，无需 arm64/QEMU），一次构建同时推 Docker Hub 与 CNB 制品库（国内源，两边 digest 一致）。

**两个镜像源：**

```
docker.io/johnhom1024/owiki              ← Docker Hub（海外/代理网络）
docker.cnb.cool/johnhom1024/owiki        ← CNB 制品库（国内直连，无需代理）
```

CNB 源挂在其代码仓库 cnb.cool/johnhom1024/owiki（Public）下，匿名可拉取。

**预发布（远程测试，不更新 latest）：**

```bash
./scripts/tag.sh beta          # 本地打 v0.0.3-beta.1
git push origin v0.0.3-beta.1  # 触发 CI
```

镜像：`johnhom1024/owiki:0.0.3-beta.1`（钉死）。GitHub 标成 pre-release。
测试机 compose 写死这个 tag，测下一份再改 yaml。

**正式发版（更新 latest）：**

```bash
./scripts/tag.sh release       # 本地打 v0.0.3
git push origin v0.0.3
```

镜像：

```
docker.io/johnhom1024/owiki:0.0.3      ← 新版本，永久保留
docker.io/johnhom1024/owiki:latest     ← 滚动指向 0.0.3
docker.cnb.cool/johnhom1024/owiki:0.0.3 / :latest   ← 同步镜像
（0.0.2、0.0.3-beta.1 等不受影响）
```

同一系列一旦打了正式 tag（如 `v0.0.3`），脚本会拒绝再打 `v0.0.3-beta.*`。

## 版本号注入

版本号经 `--build-arg VERSION` → Go `-ldflags` 注入 `main.version`，
运行时通过 `/api/health` 的 `version` 字段透出（预发布会显示 `0.0.3-beta.1`）。

## SemVer 语义

- `0.x.x`：早期开发阶段，API 与协议可能有破坏性变更
- `1.0.0` 起：承诺向后兼容（主版本内）
- 破坏性变更升主版本；新功能升次版本；修复升修订号
- 预发布用 `-beta.N`，只表示「这个正式版的第 N 个候选」，不改变上面的 SemVer 含义

## 回退

```bash
docker pull johnhom1024/owiki:0.0.1
docker tag  johnhom1024/owiki:0.0.1 johnhom1024/owiki:latest
docker compose up -d --no-pull
```
