# UI 风格规范（Live Mod 壳界面）

> 由 `ui-consistency-guard` 首次提炼自 `src/index.css` + 现有 shadcn 组件（2026-11-06）。
> 规则：新增/修改 UI 一律对照本文件，不引入新配色、新圆角体系或新图标库；默认禁用 emoji 作为图标/装饰。

## 1. 颜色令牌（唯一来源 `src/index.css`）

- 语义令牌（浅色 / 深色成对）：`background` `foreground` `card` `muted` `muted-foreground` `border` `primary` `primary-foreground` `secondary` `accent` `destructive` `success` `warning` `info` `note` `ring`
- 组件只允许使用语义工具类（`bg-background` / `text-muted-foreground` / `border-border` / `text-success` …），**禁止硬编码调色板**（`scripts/check-ui-tokens.mjs` 在 pretest 拦截）。
- 新增颜色 → 先加令牌再使用；不要写 `#xxx` / `rgb()` 字面量。

## 2. 字体与层级

- `--font-sans`：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`
- 标题：页面级 `text-2xl font-semibold`（24px）；卡片级 `CardTitle`（默认组件）
- 正文：`text-sm`（14px）；辅助说明：`text-xs text-muted-foreground`（12px）；微型：`text-[11px]`

## 3. 间距刻度

- 基础刻度 4px 网格：`1/2/3/4/6/8` 对应 4/8/12/16/24/32px
- 卡片内边距：`p-6`（24px）；卡片间距：`space-y-4` / `gap-4`
- 按钮高度：`sm`=32px，默认=36px；图标与文字间距 `gap-1.5` / `mr-2`

## 4. 圆角 / 阴影

- `--radius: 0.75rem`（12px）→ `rounded-md`(10px) `rounded-lg`(12px) `rounded-xl`(16px)
- 卡片：`rounded-lg border border-border shadow-sm`（默认 `Card` 组件）
- 浮层/弹窗：`shadow-md`；不使用自造阴影值

## 5. 交互态（必须齐全）

- hover：`hover:bg-muted` / `hover:bg-muted/50` / `hover:border-border`
- active/selected：`bg-muted` + `font-medium` 或 `border-primary`
- disabled：`disabled:opacity-50 disabled:pointer-events-none`，并给 tooltip 说明原因
- focus：沿用 `ring` 令牌（`focus-visible:ring-2 focus-visible:ring-ring`）
- loading：`RotateCw animate-spin`（既有 Loading 图标）或按钮文案「连接中…」+ disabled
- 过渡：`transition-colors duration-150` 一类既有写法，不引入动画库

## 6. 图标

- 统一使用 `lucide-react`（既有依赖）；**禁止 emoji 作为图标或装饰**。
- 品牌平台图标使用官方品牌资源：`public/platform-icons/{douyin,buyin,eos}.png`（仅用于平台识别）。
- 图标尺寸：按钮内 `size-3.5`/`size-4`；卡片图标 48×48、圆角 11px。

## 7. 组件复用

- 优先复用 `@/components/ui/*`（Button / Card / Switch / Badge / Alert / Separator …）与既有页面布局（`Page` 组件）。
- 不引入新 UI 库；不新造按钮/开关变体（如需新变体先在本文件登记）。

## 8. 壳界面特有条带

- 顶栏高度：`CHROME_H = 120`（40 Tab 行 + 44 工具行 + 36 快捷条）
- 右栏图标条：`RAIL_W = 56`；面板宽 `PANEL_W = 800`；页面区最小宽 `PAGE_MIN = 640`
- 壳内页面均为 `h-screen` 满高布局，滚动只发生在内容区
