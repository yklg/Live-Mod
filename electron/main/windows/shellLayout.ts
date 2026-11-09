// 壳布局几何唯一真源（第二期工作台）：纯函数，零 Electron import。
// 模式：workbench（52px 顶栏 + 232 左栏）/ live（52+36 + 56 左栏）/ browse（52+36+36 + 56 左栏）。
// 约束：page bounds 只由本函数产出；dock 模式让出宽度，overlay 模式 page bounds 不变。

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export type WorkspaceMode = 'workbench' | 'live' | 'browse'

export interface ShellBounds {
  chrome: Bounds
  workspace: Bounds
  rail: Bounds
  page: Bounds | null
}

export const TOPBAR_H = 52
export const BROWSER_BAR_H = 36
export const TABSTRIP_H = 36
export const LEFT_W = 232
export const LEFT_COMPACT_W = 56
export const RAIL_W = 56

export const DOCK_MIN = 320
export const DOCK_W = 360
export const DOCK_MAX = 420

// 兼容第一期命名：面板宽度已收敛为 dock 宽度。
export const PANEL_MIN = DOCK_MIN
export const PANEL_W = DOCK_W
export const PANEL_MAX = DOCK_MAX

export const PAGE_MIN = 640 // 官方页不重排的既有门禁
export const PANEL_VISIBLE_MIN = 320 // overlay 可见页硬下限

// 第一期 live 模式总高（52 产品顶栏 + 36 工具条）；保留给 notice/entry 过渡。
export const CHROME_H = TOPBAR_H + BROWSER_BAR_H
/** @deprecated 使用 chromeHeight(mode)；保留旧导出避免过渡期漏改。 */
export const DEGRADE_W = DOCK_W + RAIL_W
/** @deprecated 使用 PAGE_MIN + LEFT_COMPACT_W + RAIL_W。 */
export const MIN_WIN_WIDTH = PAGE_MIN + LEFT_COMPACT_W + RAIL_W

export function chromeHeight(mode: WorkspaceMode): number {
  if (mode === 'workbench') return TOPBAR_H
  if (mode === 'browse') return TOPBAR_H + BROWSER_BAR_H + TABSTRIP_H
  return TOPBAR_H + BROWSER_BAR_H
}

/** dock 是否放得下：必须同时保住 pageView 的 PAGE_MIN，避免官方页重排。 */
export function dockFits(winW: number, dockWidth: number = DOCK_W): boolean {
  return winW - LEFT_COMPACT_W - dockWidth - RAIL_W >= PAGE_MIN
}

export function clampDockWidth(requested: number): number {
  const value = Number.isFinite(requested) ? requested : DOCK_W
  return Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, value)))
}

/** @deprecated 兼容第一期调用点；winW 参数不再参与静态钳制。 */
export function clampPanelWidth(requested: number, _winW?: number): number {
  return clampDockWidth(requested)
}

/** 拖拽导体纯算术：向左拖变宽。 */
export function draggedPanelWidth(
  startWidth: number,
  startScreenX: number,
  screenX: number,
): number {
  return startWidth + startScreenX - screenX
}

/** @deprecated 旧阈值；dock 模式改用 dockFits。 */
export function degradeThreshold(panelWidth: number = DOCK_W): number {
  return LEFT_COMPACT_W + clampDockWidth(panelWidth) + RAIL_W
}

export interface ShellLayoutInput {
  winW: number
  winH: number
  mode?: WorkspaceMode
  dockOpen?: boolean
  dockWidth?: number
  /** 第一期兼容：等价 dockOpen。 */
  panelOpen?: boolean
  /** 第一期兼容：等价 dockWidth。 */
  panelWidth?: number
  activeTabPresent: boolean
}

/**
 * 计算壳各视图 bounds。
 * - workbench：workspace 宽 232，page=null（首页覆盖页面区）。
 * - live/browse：workspace 56；dock 打开且放得下 → page 让出 dock+rail；否则 overlay（page 不变）。
 * - overlay：rail 浮在 page 右侧，page 宽度只扣 workspace+rail。
 */
export function computeShellBounds({
  winW,
  winH,
  mode = 'live',
  dockOpen,
  dockWidth,
  panelOpen,
  panelWidth,
  activeTabPresent,
}: ShellLayoutInput): ShellBounds {
  const height = winH - chromeHeight(mode)
  const bodyY = chromeHeight(mode)
  const chrome: Bounds = { x: 0, y: 0, width: winW, height: chromeHeight(mode) }
  // workspace 视图：工作台占满「右栏条」左侧（内部再分 232 左栏 + 主区）；live/browse 只留 56 图标栏。
  const workspaceW = mode === 'workbench' ? winW - RAIL_W : LEFT_COMPACT_W
  const pageX = LEFT_COMPACT_W
  const workspace: Bounds = { x: 0, y: bodyY, width: workspaceW, height }

  const open = dockOpen ?? panelOpen ?? false
  const width = clampDockWidth(dockWidth ?? panelWidth ?? DOCK_W)
  const effectiveOpen = open && mode !== 'workbench'
  const pagePresent = activeTabPresent && mode !== 'workbench'
  const fits = effectiveOpen && dockFits(winW, width)

  let rail: Bounds
  let page: Bounds | null
  if (!effectiveOpen) {
    rail = { x: winW - RAIL_W, y: bodyY, width: RAIL_W, height }
    page = pagePresent ? { x: pageX, y: bodyY, width: winW - pageX - RAIL_W, height } : null
  } else if (fits) {
    rail = { x: winW - width - RAIL_W, y: bodyY, width: width + RAIL_W, height }
    page = pagePresent ? { x: pageX, y: bodyY, width: winW - pageX - width - RAIL_W, height } : null
  } else {
    // overlay：page 保持与收起态相同，rail 覆盖在 page 右侧。
    rail = { x: winW - width - RAIL_W, y: bodyY, width: width + RAIL_W, height }
    page = pagePresent ? { x: pageX, y: bodyY, width: winW - pageX - RAIL_W, height } : null
  }

  return { chrome, workspace, rail, page }
}

/** 入口/首页覆盖页面区：chrome 下、rail 左侧；入口过渡期仍使用。 */
export function computeEntryBounds({
  winW,
  winH,
  mode = 'live',
}: {
  winW: number
  winH: number
  mode?: WorkspaceMode
}): Bounds {
  const y = chromeHeight(mode)
  return { x: 0, y, width: winW - RAIL_W, height: winH - y }
}
