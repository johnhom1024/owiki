# owiki 任务清单

BINARY := owiki
TOKEN ?= dev-token-change-me

# --- 服务端版本注入 ---
# 默认从 git 拿最近 tag，没有则用 "dev"。用 `make build VERSION=0.3.0` 覆盖。
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -X main.version=$(VERSION)

# --- Obsidian 插件部署变量 ---
# 插件已剥离为独立仓库（GitHub: johnhom1024/owiki-sync，上架社区市场用）
# 默认取同级的 ../owiki-sync，可用 PLUGIN_SRC 覆盖
PLUGIN_SRC  ?= ../owiki-sync
# 目标 vault 的插件目录（覆盖示例：make plugin-deploy PLUGIN_DEST=...）
# 默认指向 johnhom 本机的 iCloud vault，按需改
PLUGIN_DEST ?= $(HOME)/Library/Mobile Documents/iCloud~md~obsidian/Documents/笔记/.obsidian/plugins/owiki-sync
PLUGIN_ID   := owiki-sync
# 设为 0 可在非 Mac/CI 环境跳过 Obsidian CLI 重载
PLUGIN_RELOAD ?= 1

# Go 通过 //go:embed web/dist/* 把前端嵌进二进制；产物 gitignore，clone 后默认没有。
WEB_DIST := web/dist/index.html

.PHONY: run build start test-client web web-dev web-build ensure-web ensure-go clean help \
        plugin-build plugin-deploy plugin-reload plugin-clean \
        tag-list tag-beta tag-release

run: ensure-go ensure-web            ## 开发运行（默认 :8787；缺 web/dist 时自动构建前端）
	go run -ldflags '$(LDFLAGS)' .

build: ensure-go ensure-web          ## 编译二进制（含嵌入 Web 前端）。VERSION 可覆盖
	go build -ldflags '$(LDFLAGS)' -o $(BINARY) .

ensure-go:
	@command -v go >/dev/null 2>&1 || { \
		echo ""; \
		echo "❌ 从源码启动需要 Go（建议 1.22+）"; \
		echo "   Need Go to build the server."; \
		echo "   安装: https://go.dev/dl/"; \
		echo ""; \
		exit 1; \
	}

# 内部目标：缺产物才构建，避免每次 make run 都重打前端。
ensure-web:
	@if [ ! -f "$(WEB_DIST)" ]; then \
		echo "→ web/dist 不存在，先构建 Web 前端（Go embed 需要这份产物；首次会花一点时间）"; \
		$(MAKE) web-build; \
	fi

web-build:          ## 强制重建 Web 前端到 web/dist
	@command -v pnpm >/dev/null 2>&1 || { \
		echo ""; \
		echo "❌ 从源码启动需要 pnpm（构建 Web 前端，随后由 Go embed 进二进制）"; \
		echo "   Need pnpm to build the web UI before go:embed."; \
		echo "   安装:  npm install -g pnpm  |  brew install pnpm  |  corepack enable"; \
		echo "   https://pnpm.io/installation"; \
		echo ""; \
		exit 1; \
	}
	@command -v node >/dev/null 2>&1 || { \
		echo ""; \
		echo "❌ 从源码启动需要 Node.js（Web 前端构建）"; \
		echo "   Need Node.js to build the web UI."; \
		echo "   安装: https://nodejs.org/"; \
		echo ""; \
		exit 1; \
	}
	@echo "→ 安装 / 校验 Web 前端依赖"
	cd web && pnpm install
	@echo "→ 构建 Web 前端 → web/dist"
	cd web && pnpm build
	@test -f "$(WEB_DIST)" || { echo "❌ 前端构建失败：没有生成 $(WEB_DIST)"; exit 1; }
	@echo "✅ 前端已就绪: $(WEB_DIST)"

web: web-build          ## 强制重建前端并编译二进制
	$(MAKE) build

web-dev:        ## Web 前端开发模式（:5174，代理到 :8787，改代码即时生效）
	cd web && pnpm dev

start: build    ## 编译并启动
	OWIKI_TOKEN=$(TOKEN) ./$(BINARY)

test-client:    ## 协议端到端测试（需服务端已启动）
	go run ./cmd/testclient

clean:          ## 清理产物和本地库
	rm -f $(BINARY) owiki-bin owiki.db

# --- Obsidian 插件（源码在独立仓库 $(PLUGIN_SRC)） ---

plugin-build:   ## 构建插件（在 PLUGIN_SRC 目录执行 esbuild + tsc）
	@if [ ! -d "$(PLUGIN_SRC)" ]; then \
		echo "❌ $(PLUGIN_SRC) 不存在，请先克隆 johnhom1024/owiki-sync"; exit 1; \
	fi
	@if [ ! -d "$(PLUGIN_SRC)/node_modules" ]; then \
		echo "→ 安装插件依赖"; \
		(cd "$(PLUGIN_SRC)" && pnpm install); \
	fi
	cd "$(PLUGIN_SRC)" && node esbuild.config.mjs production
	cd "$(PLUGIN_SRC)" && npx tsc --noEmit
	@echo "✅ 插件构建完成: $(PLUGIN_SRC)/dist/main.js"

plugin-deploy: plugin-build   ## 一键部署：构建+拷贝+重载（PLUGIN_RELOAD=0 跳过重载）
	@if [ ! -d "$(PLUGIN_SRC)/dist" ]; then \
		echo "❌ $(PLUGIN_SRC)/dist 不存在，build 阶段出问题"; exit 1; \
	fi
	@mkdir -p "$(PLUGIN_DEST)"
	cp "$(PLUGIN_SRC)/dist/main.js" "$(PLUGIN_SRC)/manifest.json" "$(PLUGIN_DEST)/"
	@if [ -f "$(PLUGIN_SRC)/styles.css" ]; then cp "$(PLUGIN_SRC)/styles.css" "$(PLUGIN_DEST)/"; fi
	@echo "✅ 已部署到 $(PLUGIN_DEST)"
	@if [ "$(PLUGIN_RELOAD)" = "0" ]; then \
		echo "→ PLUGIN_RELOAD=0，跳过 Obsidian CLI 重载"; \
	elif command -v obsidian >/dev/null 2>&1; then \
		obsidian plugin:reload id=$(PLUGIN_ID) && echo "✅ 插件已重载"; \
	else \
		echo "⚠️  obsidian CLI 不在 PATH，跳过重载（在 Obsidian 里手动禁用→启用即可）"; \
	fi

plugin-reload:  ## 仅触发 Obsidian CLI 插件重载（需 obsidian CLI 在 PATH）
	@command -v obsidian >/dev/null 2>&1 || { \
		echo "❌ obsidian CLI 不在 PATH"; exit 1; \
	}
	obsidian plugin:reload id=$(PLUGIN_ID)

plugin-clean:   ## 清理插件构建产物（dist + node_modules）
	rm -rf "$(PLUGIN_SRC)/dist" "$(PLUGIN_SRC)/node_modules"

# --- 发版 tag（只打本地 tag，不 push） ---

tag-list:       ## 列出正式版 / beta tag 和下一步建议
	@./scripts/tag.sh list

tag-beta:       ## 提议并打下一个 beta tag（SERIES=0.0.3 可指定系列）
	@./scripts/tag.sh beta $(SERIES)

tag-release:    ## 提议并打下一个正式版 tag（TAG_VERSION=0.0.3 可指定）
	@./scripts/tag.sh release $(TAG_VERSION)

help:           ## 显示帮助
	@echo "用法: make <target>，可用任务:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
