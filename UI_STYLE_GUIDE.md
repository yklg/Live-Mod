# UI 风格规范（Live Mod 壳界面）

> 2026-11-10 按“壳视觉统一 + 工作台回退”更新：右栏 Panel、entry 启动、无左栏几何、12px 卡片/13px 正文。
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
- 页面标题：15px / 22px；面板标题：13px / 18px；卡片标题：13px / 18px
- `--text-sm` 已由 `@theme inline` 覆盖为 13/20；禁止在右栏业务页新增 14px 正文（`text-[14px]`/`text-base`）
- 代码/数字：`--font-mono`，表格数字用 `font-variant-numeric: tabular-nums`

## 3. 间距刻度

- 基础 4px 网格：`1/2/3/4/6/8` = 4/8/12/16/24/32px
- 卡片内边距：12px；卡片间距：12px；页面区块间距：12px
- 控件高度：`sm`=28px、默认=30px、大=36px；Input=32px；图标与文字间距 6px

## 4. 圆角 / 阴影 / 发丝线

- 圆角刻度：6 / 8 / 10 / 12 / 16px；卡片 12px；浮窗 16px
- 卡片：`rounded-card border-hairline border-border shadow-elevation-1`
- 浮层/浮窗：`rounded-float shadow-float`；不使用自造阴影值
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
- 图标尺寸：按钮内 `size-3.5`/`size-4`；平台卡图标 40×40、圆角 10px

## 8. 壳界面几何

- 顶栏三行：产品顶栏 `TOPBAR_H=52`；浏览器工具条 `BROWSER_BAR_H=36`（仅 live/browse）；标签行 `TABSTRIP_H=36`（仅 browse）。总高 entry 52 / live 88 / browse 124；窗口最小宽 1024
- 无左栏：page x=0；entry 视图覆盖 page 区域（`winW-RAIL_W`），entry 模式强制关闭 dock；右侧业务条保留 `RAIL_W=56`
- 右栏图标条：`RAIL_W=56`；6 项业务图标 + 帮助（不含 AI）；按钮 40×38/圆角 9，短标签 8px
- dock：`DOCK_MIN=320`、默认 `360`、`DOCK_MAX=420`；宽度持久化（LayoutStore v2）
- dock 模式让出官方页宽度；无左栏后 `dockFits` 以 `PAGE_MIN=640` 为门槛（360→1056、420→1116，1024 一律 overlay）；1280+dock360 page=864，1024 无 dock page=968；entry 1280 宽 1224、1024 宽 968
- 面板标题单一源：ShellRail 头 `h-10` 标题（13px，`data-testid="panel-title"`）是唯一 h1；`SHELL_ROUTES.panelTitle` 供标题，Page 在 panel 内隐藏重复标题，有 back/actions 时保留紧凑行
- 中控是常驻表面：`kind:'account'` 的账号 Tab 不进标签行、不可由 UI 关闭；标签行只显示自由浏览的 free/popup Tab
- AI 助手：全局浮窗，默认 520×640、最小 400×440、边距 12、吸附 20/28；顶栏 sparkle + `⌘J` 开关；右栏无 AI 图标/面板；配置在浮窗「更多」

## 9. 组件复用

- 优先复用 `@/components/ui/*`（Button / Card / Switch / Badge / Alert / Separator …）与既有页面布局（`Page` 组件）。
- 右栏面板统一用 `PanelSummary` / `PanelSection` / `PanelRow`（`@/components/common/Panel`）；分组 label 10px，行高 40。
- 不引入新 UI 库；不新造按钮/开关变体（如需新变体先在本文件登记）。
- 业务页统一使用 `FormField` / `NumberRangeField` / `SwitchRow` / `SectionCard` / `StatusBadge` / `ListEmpty`（批次五落地）。
