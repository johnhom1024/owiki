# owiki —— Go 单二进制 + 嵌入式 Web 前端（React/Vite）
# 多阶段构建：前端构建 → Go 构建（go:embed web/dist）→ 精简运行镜像

# ---------- 阶段 1：构建前端 ----------
FROM node:22-alpine AS web-builder
WORKDIR /build/web

# 先复制依赖清单，利用 Docker 层缓存
COPY web/package.json web/pnpm-lock.yaml ./
# pnpm 版本与 web/package.json 的 packageManager 锁死同版：
# pnpm 11.x 各小版对 overrides 的解析规则有差异，浮动版本会触发
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH（frozen install 校验失败）。
RUN npm install -g pnpm@11.15.0 && pnpm install --frozen-lockfile

# 复制前端源码并构建（产物输出到 web/dist）
COPY web/ ./
RUN pnpm run build

# ---------- 阶段 2：构建 Go 二进制 ----------
FROM golang:1.26.7-alpine AS go-builder
WORKDIR /build

# VERSION 由发版 workflow（.github/workflows/release.yml）通过 --build-arg 注入。
# 未注入时回退 "dev"，与 main.go 默认值一致。
ARG VERSION=dev

# 先拉依赖，利用层缓存
COPY go.mod go.sum ./
RUN go mod download

# 复制全部源码，并放入前端构建产物（main.go 的 go:embed web/dist/* 依赖它）
COPY . .
COPY --from=web-builder /build/web/dist ./web/dist

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/owiki .

# ---------- 阶段 3：运行 ----------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && mkdir -p /data

WORKDIR /app
COPY --from=go-builder /out/owiki /app/owiki

ENV OWIKI_DB=/data/owiki.db \
    OWIKI_ADDR=:8787

VOLUME /data
EXPOSE 8787

ENTRYPOINT ["/app/owiki"]
