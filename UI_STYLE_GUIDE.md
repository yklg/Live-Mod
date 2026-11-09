# UI 风格规范（Live Mod 壳界面）

> 2026-11-09 按第一期计划更新。组件按批次迁移；未迁移处暂以现有实现为准。
> 规则：新增/修改 UI 一律对照本文件；不引入新配色、新圆角体系或新图标库；默认禁用 emoji 作为图标/装饰。

## 1. 颜色令牌（唯一来源 `src/index.css`）

- **原料层**：`--lm-neutral-*`、`--lm-brand-*`，只允许在 `index.css` 定义，组件不直接消费。
- **语义层**：`background` `foreground` `card` `muted` `muted-foreground` `border` `primary` `primary-foreground` `secondary` `accent` `destructive` `success` `warning` `info` `note` `ring`
- **表面/层级**：`surface-1` `surface-2` `surface-3` `border-hairline` `elevation-1` `elevation-2` `elevation-float`
- 组件只允许使用语义工具类（`bg-background` / `text-muted-foreground` / `border-border` / `text-success` …），**禁止硬编码调色板**（`scripts/check-ui-tokens.mjs` 在 pretest 拦截）。
- 新增颜色 → 先加令牌再使用；不要写 `#xxx` / `rgb()` 字面量。

## 2. 字体与层级

- `--font-sans`：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`
- 正文：13px / 20px；次要：12px / 18px；微型：11px / 16px
- 页面标题：20px / 28px；面板标题：15px / 22px
- 代码/数字：`--font-mono`，表格数字用 `font-variant-numeric: tabular-nums`

## 3. 间距刻度

- 基础 4px 网格：`1/2/3/4/6/8` = 4/8/12/16/24/32px
- 卡片内边距：16px；卡片间距：12px；页面区块间距：16px
- 控件高度：`sm`=28px、默认=32px、大=36px；图标与文字间距 6px

## 4. 圆角 / 阴影 / 发丝线

- 圆角刻度：6 / 8 / 10 / 12 / 16px；卡片 12px；浮窗 16px
- 卡片：`rounded-lg border-hairline border-border shadow-elevation-1`
- 浮层/浮窗：`shadow-float`；不使用自造阴影值
- 发丝线统一 0.5px（`border-hairline`）；非 Retina 退化为 1px 可接受

## 5. 动效

- 时长：`--motion-fast` 100ms / `--motion-base` 180ms / `--motion-slow` 280ms
- 曲线：`--ease-standard` = `cubic-bezier(.2,0,0,1)`
- 尊重 `prefers-reduced-motion`；拖拽进行中关闭过渡，仅在离散开合时缓动

## 6. 交互态（必须齐全）

- hover：`hover:bg-muted` / `hover:bg-muted/50` / `hover:border-border`
- active/selected：`bg-muted` + `font-medium` 或 `border-primary`
- disabled：`disabled:opacity-50 disabled:pointer-events-none`，并给 tooltip 说明原因
- focus：`focus-visible:ring-2 focus-visible:ring-ring`
- loading：`RotateCw animate-spin` 或按钮文案「连接中…」+ disabled
- 过渡：`transition-colors duration-150` 一类既有写法；不引入动画库

## 7. 图标

- 统一使用 `lucide-react`；**禁止 emoji 作为图标或装饰**
- 品牌平台图标使用官方品牌资源：`public/platform-icons/{douyin,buyin,eos}.png`
- 图标尺寸：按钮内 `size-3.5`/`size-4`；卡片图标 48×48、圆角 11px

## 8. 壳界面几何

- 顶栏：`CHROME_H=88`（40 Tab 行 + 48 工具行）；窗口最小宽 1024
- 右栏图标条：`RAIL_W=56`；**7 项业务图标（不含 AI）**
- 功能面板：`PANEL_MIN=420`、默认 `600`、`PANEL_MAX=min(880, winW - RAIL_W - PANEL_VISIBLE_MIN)`
- `PANEL_VISIBLE_MIN=320`（待 1024 真机验证；重排则抬到 400）；与 `PAGE_MIN` 分义，禁止复用
- 面板是 overlay：展开不压缩官方页宽度；宽度只改变遮挡面积；保留「让出右侧看网页」
- AI 助手：全局浮窗，默认 520×640、最小 400×440、边距 12、吸附 20/28；顶栏 sparkle + `⌘J` 开关；右栏无 AI 图标/面板；配置在浮窗「更多」

## 9. 组件复用

- 优先复用 `@/components/ui/*`（Button / Card / Switch / Badge / Alert / Separator …）与既有页面布局（`Page` 组件）。
- 不引入新 UI 库；不新造按钮/开关变体（如需新变体先在本文件登记）。
- 业务页统一使用 `FormField` / `NumberRangeField` / `SwitchRow` / `SectionCard` / `StatusBadge` / `ListEmpty`（批次五落地）。
