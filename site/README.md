# OWiki 官网

OWiki 的宣传官网，中英双语，Obsidian 暗紫风格。

- 技术栈：React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + lucide-react（详见 johnhom 前端选型）
- 开发：`pnpm dev`（端口 5175，避免与 web/ 的 5174 冲突）
- 构建：`pnpm build`，产物在 `dist/`
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

## 内容区块

Hero（含同步动画演示图）→ 特性 → 同步原理（含协议表）→ 快速开始（Docker/compose/二进制 三 tab）→ AI 开放接口 → 安全 → FAQ → Footer

## 发布

构建产物是纯静态文件，可发布到 static-hub（`https://static.johnhong.cn/app/<appId>`）：

```bash
pnpm build
cd dist && zip -r site.zip . && curl -X POST https://static.johnhong.cn/api/apps/upload -F "name=owiki-site" -F "archive=@site.zip"
```

> 注意：`site/` 不在 `.cnb.yml` 的 `ifModify` 白名单里，改动不会触发 Docker 镜像构建。
