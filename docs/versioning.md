# 版本与镜像发布策略

OWiki 采用主流开源项目的「latest 滚动 + 版本号永久保留」分发模式。

## Tag 约定

| 层面 | 格式 | 示例 | 说明 |
| --- | --- | --- | --- |
| git tag | `v` + SemVer | `v0.0.1` | git 社区惯例，标记一次发版 |
| 镜像 tag | 纯 SemVer | `0.0.1` | Docker 社区惯例（nginx/postgres 同款） |
| 滚动 tag | `latest` | — | 永远指向最新一次发版 |

## 发版流程（当前为手动）

```bash
# 1. 打 tag
git tag v0.0.2 && git push origin v0.0.2

# 2. 构建并推送镜像（本地 Docker，一次构建双 tag）
docker build --build-arg VERSION=0.0.2 \
  -t johnhom1024/owiki:0.0.2 -t johnhom1024/owiki:latest .
docker push johnhom1024/owiki:0.0.2
docker push johnhom1024/owiki:latest

# 3.（可选）同步国内 CNB 制品库
docker tag johnhom1024/owiki:0.0.2 docker.cnb.cool/johnhom1024/owiki:0.0.2
docker tag johnhom1024/owiki:latest docker.cnb.cool/johnhom1024/owiki:latest
docker push docker.cnb.cool/johnhom1024/owiki:0.0.2
docker push docker.cnb.cool/johnhom1024/owiki:latest
```

发版后镜像分布：

```
docker.io/johnhom1024/owiki:0.0.2      ← 新版本，永久保留
docker.io/johnhom1024/owiki:latest     ← 滚动指向 0.0.2
（旧 tag 0.0.1 等不受影响，随时可回退）
```

## 版本号注入

版本号经 `--build-arg VERSION` → Go `-ldflags` 注入 `main.version`，
运行时通过 `/api/health` 的 `version` 字段透出，可用于部署后验证与排障。

## SemVer 语义

- `0.x.x`：早期开发阶段，API 与协议可能有破坏性变更
- `1.0.0` 起：承诺向后兼容（主版本内）
- 破坏性变更升主版本；新功能升次版本；修复升修订号

## 回退

```bash
docker pull johnhom1024/owiki:0.0.1
docker tag  johnhom1024/owiki:0.0.1 johnhom1024/owiki:latest
docker compose up -d --no-pull
```
