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

### 5.1 可执行判据（壳 v3 · Wave 2 落地，不再只是原则）

- **令牌落地**：motion 令牌已登记进 `@theme inline`（`src/index.css`），Tailwind 才会生成
  `duration-motion-base` / `ease-standard`；另外提供 `motion-base` / `motion-fast` / `motion-slow`
  工具类——`tw-animate-css` 的 `animate-in/out` 走 `animation: enter var(--tw-duration,.15s) var(--tw-ease,ease)`
  简写，**只写 `duration-*` 会被简写里的 .15s 覆盖**，必须传 `--tw-duration` / `--tw-ease`。
- **开合对称**：出现与收起都要有动画，淡入 + 约 8px 位移（菜单从右上、面板从右）。
- **离场载体**：条件渲染（`cond && <Node/>`）在收起时直接卸载节点，离场动画**没有播放机会**。
  收起类必须改为「保留节点 + `data-state`（open/closed）」或包 Presence，动画结束再卸载。
- **reduced-motion 双保险**：CSS `@media (prefers-reduced-motion: reduce)` 把动画/过渡降为瞬时
  **且延迟为 0**；JS 侧同步跳过离场等待（否则会白等一个动画时长）。**最终状态必须完整可见可点**，
  不得把内容与动画一起跳过。
- **原生几何不缓动**：`WebContentsView.setBounds` 是原生几何，CSS 过渡/动画对 view 边界**完全无效**；
  开合动画只能落在 view 内部的 DOM 内容层。
- **判据写法**：一律用**元素级** `getAnimations()` 按动画名前缀与 `playState` 过滤，
  禁用全量 `document.getAnimations()`（常驻 skeleton pulse 会污染结果）。

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

- 顶栏三行：产品顶栏 `TOPBAR_H=52`；浏览器工具条 `BROWSER_BAR_H=36`（非 entry）；标签行 `TABSTRIP_H=36`（非 entry 常显）。总高 entry 52 / live 124 / browse 124；窗口最小宽 1024
- 无左栏：page x=0；entry 视图覆盖 page 区域（满宽 `winW`），entry 模式强制关闭 dock 与悬浮菜单
- **右栏图标条已删除（壳 v3 · Wave 2）**：rail 视图自此**只承载面板**，收起时宽度归零
  （`width=0`，视图保留不销毁——`railReady` 握手依赖它存在）；功能入口改由**顶栏悬浮菜单**承担
- 顶栏悬浮菜单：`MENU_W=232`、`MENU_H=296`，固定尺寸浮在页面右上，**不挤占官方页**
  （菜单开时 page 仍满宽）；与面板**互斥**：开菜单面板让位（记下 route 以便恢复），
  选中项则菜单关、面板开；菜单态**不写持久化**（开关菜单不改 `LayoutStore.dockOpen`）
- dock：`DOCK_MIN=320`、默认 `360`、`DOCK_MAX=420`；宽度持久化（LayoutStore v2）
- **面板默认浮层覆盖（overlay）**：page 永远满宽，面板浮在右侧；`dockFits`/`PAGE_MIN` 只在保留的
  `layoutMode='dock'` 分支生效（门槛 `PAGE_MIN=640` → 360→1000、420→1060），默认不启用
- 面板标题单一源：ShellRail 头 `h-10` 标题（13px，`data-testid="panel-title"`）是唯一 h1；`SHELL_ROUTES.panelTitle` 供标题，Page 在 panel 内隐藏重复标题，有 back/actions 时保留紧凑行
- 中控是标签轴上的固定第一张卡：`kind:'account'` 的账号 Tab 固定在最左、不可由 UI 关闭、不可拖动；free/popup Tab 追加其后。mode 由 active Tab 类型派生（account→live / free|popup→browse），不再有「自由浏览」模式开关
- AI 助手：全局浮窗，默认 520×640、最小 400×440、边距 12、吸附 20/28；顶栏 sparkle + `⌘J` 开关；右栏无 AI 图标/面板；配置在浮窗「更多」

## 9. 组件复用

- 优先复用 `@/components/ui/*`（Button / Card / Switch / Badge / Alert / Separator …）与既有页面布局（`Page` 组件）。
- 右栏面板统一用 `PanelSummary` / `PanelSection` / `PanelRow`（`@/components/common/Panel`）；分组 label 10px，行高 40。
- 不引入新 UI 库；不新造按钮/开关变体（如需新变体先在本文件登记）。
- 业务页统一使用 `FormField` / `NumberRangeField` / `SwitchRow` / `SectionCard` / `StatusBadge` / `ListEmpty`（批次五落地）。
