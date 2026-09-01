# tsconfig 说明（TypeScript 6 / 7）

> owiki-web 实测：Vite 8 + React 19。
> 项目编译用 TypeScript **6.0.3**；VS Code 若启用 Native Preview 则是 TypeScript **7.0.2（tsgo）**。

## 结论：当前 `tsconfig.json` 是正确的

当前配置：

- **没有** `baseUrl`
- `paths` 为 `"@/*": ["./src/*"]`

用项目 `tsc`（6.0.3）和 VS Code 扩展里的 tsgo（7.0.2）跑 `--noEmit` 都通过。

## 那条提示是谁打的

```
Option 'baseUrl' has been removed. Please remove it from your configuration.
Use '"paths": {"*": ["./*"]}' instead.
```

这是 **TypeScript 7（tsgo）的 `TS5102`**：配置里出现了 `baseUrl`。

| 配置 | TS 6.0.3 | TS 7.0.2 |
|---|---|---|
| 无 `baseUrl`，`"@/*": ["./src/*"]` | 通过 | 通过 |
| `"baseUrl": "."` | `TS5101` deprecated，TS 7 会停用 | `TS5102` has been removed |

本仓库已经不写 `baseUrl`。若编辑器仍报，检查是否开了 `js/ts.experimental.useTsgo`，以及打开的是不是另一份还留着 `baseUrl` 的 tsconfig。

## 正确写法

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

不要写 `baseUrl`。也不要把 `@/` 改成提示里的 `"*": ["./*"]`——那只是替代旧 `baseUrl` 的写法，会让所有 `@/xxx` 找不到模块。

Vite 运行时别名在 `vite.config.ts` 的 `resolve.alias`，和 tsconfig 是分开的。

## 验证

```bash
cd web
pnpm exec tsc --version    # 6.0.3
pnpm exec tsc --noEmit
pnpm build
```
