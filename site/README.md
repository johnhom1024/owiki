# OWiki 官网

OWiki 的宣传官网，中英双语，Obsidian 暗紫风格。

- 技术栈：React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + lucide-react（详见 johnhom 前端选型）
- 开发：`pnpm dev`（端口 5175，避免与 web/ 的 5174 冲突）
- 构建：`pnpm build`，产物在 `dist/`。子路径构建和预览须使用相同环境变量，例如 `SITE_BASE=/owiki/ pnpm build`、`SITE_BASE=/owiki/ pnpm preview`。
- 双语切换：右上角按钮 / `?lang=en`，偏好存 localStorage（`owiki-site-lang`）

## 结构

```
src/
├── i18n/
│   ├── content.ts        # 全部双语文案（单一事实源）
│   └── LangProvider.tsx  # 语言 context + 切换
├── components/           # Header/Hero/Features/SyncHow/QuickStart/OpenApi/Security/Faq/Footer
├── lib/utils.ts          # cn()
├── index.css             # Tailwind v4 主题（暗紫设计令牌 + 动画）
└── App.tsx
```

## 使用文档

- 首页导航「使用文档」与主按钮进入 `docs/?page=quickstart`。
- `docs/index.html` 是独立 Vite 构建入口，不依赖服务端 SPA fallback；兼容 `SITE_BASE=/owiki/`。文章使用 `?page=`，章节使用 `#section-id`，可直接分享、刷新和前进后退。
- `src/docs/Docs.tsx`：三栏布局、侧栏搜索、移动端无障碍 Sheet、本页目录、代码复制、上一篇/下一篇。
- `src/docs/content.ts`：中英双语文章数据。新增文章加入对应语言数组，侧栏与文章间导航自动生成；两种语言保持相同 slug 与章节 ID。
- 文档 UI 原语在 `src/components/ui/`，使用 shadcn 风格的 Button / Radix Sheet。
- 浏览器回归：`pnpm exec playwright install chromium` 后运行 `pnpm test:e2e`，自动构建 `/owiki/` 子路径版本并启动临时预览验证。

## 内容区块

Hero（含同步动画演示图）→ 特性 → 同步原理（含协议表）→ 快速开始（Docker/compose/二进制 三 tab）→ AI 开放接口 → 安全 → FAQ → Footer

## 发布

部署在 **GitHub Pages**：https://johnhom1024.github.io/owiki/

`.github/workflows/site.yml` 在 push main 且 `site/**` 有变更时自动构建部署（`SITE_BASE=/owiki/`），无需手动操作；也可在 Actions 页手动 workflow_dispatch。

> 注意：`site/` 改动只触发官网部署；Docker 镜像构建由 `v*` tag 触发（`.github/workflows/release.yml`），两者互不影响。
