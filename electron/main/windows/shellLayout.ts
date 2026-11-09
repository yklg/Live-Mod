// 壳布局几何唯一真源（guangquan-shell-ui-parity v3 · A3）——纯函数，零 Electron import。
// 范式沿用 popupPolicy/foldNavigate/pageFactory「纯决策函数 + 薄执行壳」：
// shellUI/panelController 只消费本函数产出的 bounds 做 setBounds，禁止在别处算几何。
// 测试锚：shellLayout.test.ts TC-L1~L13（决策表/边界/不变量/纯性）。

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellBounds {
  chrome: Bounds
  rail: Bounds
  page: Bounds | null
}

export const CHROME_H = 88 // 40 Tab 行 + 48 工具行（快捷条已收进工具行）
export const RAIL_W = 56 // 收起态图标条宽
// 面板宽度 = 纯产品参数（遮挡面积），**布局不依赖该值**：面板树用容器查询 @xl/panel 适配，
// 因此 600/800 均可；旧 800 曾用于补偿 CSS md(768) 断点（视口=面板宽度），容器化后不再需要。
export const PANEL_W = 600
export const PANEL_MIN = 420
export const PANEL_MAX = 880
// overlay 下至少留给官方页的可视宽度；与 PAGE_MIN（pageView 最小宽）不是同一语义，禁止复用。
export const PANEL_VISIBLE_MIN = 320
export const PAGE_MIN = 640 // A0 门禁实证官方页可用宽度
// 降级阈值：默认宽度下的历史阈值；实际按当前 panelWidth + RAIL_W 计算（见 degradeThreshold）。
export const DEGRADE_W = PANEL_W + RAIL_W

/** 当前面板宽度下的降级阈值：winW 小于它时面板无法以 overlay 宽度放下。 */
export function degradeThreshold(panelWidth: number = PANEL_W): number {
  return panelWidth + RAIL_W
}

/** 面板宽度钳制：先保证 PANEL_VISIBLE_MIN，再受 PANEL_MAX 约束；非数回默认。 */
export function clampPanelWidth(requested: number, winW: number): number {
  const value = Number.isFinite(requested) ? requested : PANEL_W
  const maxByWindow = winW - RAIL_W - PANEL_VISIBLE_MIN
  const upper = Math.max(PANEL_MIN, Math.min(PANEL_MAX, maxByWindow))
  return Math.round(Math.min(upper, Math.max(PANEL_MIN, value)))
}

/** 拖拽导体的纯宽度算术：向左拖（screenX 减小）变宽，向右拖变窄。 */
export function draggedPanelWidth(
  startWidth: number,
  startScreenX: number,
  screenX: number,
): number {
  return startWidth + startScreenX - screenX
}
// 历史阈值（未接入运行时；实际窗口下限由 app.ts minWidth=1024 控制），仅保留纯函数性质测试。
export const MIN_WIN_WIDTH = PAGE_MIN + RAIL_W

export interface ShellLayoutInput {
  winW: number
  winH: number
  panelOpen: boolean
  activeTabPresent: boolean
  /** 当前面板宽度；缺省 PANEL_W（旧调用点零变化）。 */
  panelWidth?: number
}

/**
 * 计算三 view 的完整 bounds（chrome 顶栏恒全宽；rail 右缘常驻；page 铺满 chrome 下方剩余区）。
 * overlay 语义：面板展开只改 rail bounds，page bounds 与收起态逐键相同（TC-L11）。
 * 降级规则：winW < 当前 panelWidth + RAIL_W 时 rail 全宽覆盖（跟随实际宽度，而非固定 600）。
 */
export function computeShellBounds({
  winW,
  winH,
  panelOpen,
  activeTabPresent,
  panelWidth,
}: ShellLayoutInput): ShellBounds {
  const chrome: Bounds = { x: 0, y: 0, width: winW, height: CHROME_H }

  const bodyY = CHROME_H
  const bodyH = winH - CHROME_H
  const width = clampPanelWidth(panelWidth ?? PANEL_W, winW)

  let rail: Bounds
  if (!panelOpen) {
    rail = { x: winW - RAIL_W, y: bodyY, width: RAIL_W, height: bodyH }
  } else if (winW >= degradeThreshold(width)) {
    rail = { x: winW - width, y: bodyY, width, height: bodyH }
  } else {
    rail = { x: 0, y: bodyY, width: winW, height: bodyH }
  }

  const page: Bounds | null = activeTabPresent
    ? { x: 0, y: bodyY, width: winW - RAIL_W, height: bodyH }
    : null

  return { chrome, rail, page }
}

/**
 * 壳入口选择器视图 bounds（shell-entry-platform-selector v1）：
 * 覆盖「页面区」——chrome 下、常驻 rail 图标条左侧。与 page bounds 同形但**不依赖活跃 Tab**
 * （入口出现时页面可能尚未建/已关闭）。notice 通知层为独立透明窗口（需窗口级点击穿透），
 * 不复用本视图几何——两者定位方式不同，见 windows/noticeWindow.ts。
 */
export function computeEntryBounds({ winW, winH }: { winW: number; winH: number }): Bounds {
  return { x: 0, y: CHROME_H, width: winW - RAIL_W, height: winH - CHROME_H }
}
