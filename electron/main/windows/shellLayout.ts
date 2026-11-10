// 壳布局几何唯一真源：纯函数，零 Electron import。
// 模式：entry（52px 顶栏，无左栏）/ live（52+36）/ browse（52+36+36）。
// 约束：page bounds 只由本函数产出；dock 模式让出宽度，overlay 模式 page bounds 不变；entry 模式关闭 dock。

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export type ShellMode = 'entry' | 'live' | 'browse'

export interface ShellBounds {
  chrome: Bounds
  entry: Bounds | null
  rail: Bounds
  page: Bounds | null
}

export const TOPBAR_H = 52
export const BROWSER_BAR_H = 36
export const TABSTRIP_H = 36
export const RAIL_W = 56

export const DOCK_MIN = 320
export const DOCK_W = 360
export const DOCK_MAX = 420

export const PAGE_MIN = 640 // 官方页不重排的既有门禁

// live 模式总高（52 产品顶栏 + 36 工具条）；notice 等子窗口初始位置兼容用。
export const CHROME_H = TOPBAR_H + BROWSER_BAR_H

export function chromeHeight(mode: ShellMode): number {
  if (mode === 'entry') return TOPBAR_H
  if (mode === 'browse') return TOPBAR_H + BROWSER_BAR_H + TABSTRIP_H
  return TOPBAR_H + BROWSER_BAR_H
}

/** dock 是否放得下：必须保住 pageView 的 PAGE_MIN，避免官方页重排。 */
export function dockFits(winW: number, dockWidth: number = DOCK_W): boolean {
  return winW - dockWidth - RAIL_W >= PAGE_MIN
}

export function clampDockWidth(requested: number): number {
  const value = Number.isFinite(requested) ? requested : DOCK_W
  return Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, value)))
}

/** 拖拽导体纯算术：向左拖变宽。 */
export function draggedPanelWidth(
  startWidth: number,
  startScreenX: number,
  screenX: number,
): number {
  return startWidth + startScreenX - screenX
}

export interface ShellLayoutInput {
  winW: number
  winH: number
  mode?: ShellMode
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
 * - entry：entry 覆盖页面区，page=null，dock 强制收起。
 * - live/browse：page x=0；dock 打开且放得下 → page 让出 dock + rail；否则 overlay（page 不变）。
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
  const bodyY = chromeHeight(mode)
  const height = winH - bodyY
  const chrome: Bounds = { x: 0, y: 0, width: winW, height: bodyY }

  const open = (dockOpen ?? panelOpen ?? false) && mode !== 'entry'
  const width = clampDockWidth(dockWidth ?? panelWidth ?? DOCK_W)
  const pagePresent = activeTabPresent && mode !== 'entry'
  const fits = open && dockFits(winW, width)

  let rail: Bounds
  let page: Bounds | null
  if (!open) {
    rail = { x: winW - RAIL_W, y: bodyY, width: RAIL_W, height }
    page = pagePresent ? { x: 0, y: bodyY, width: winW - RAIL_W, height } : null
  } else if (fits) {
    rail = { x: winW - width - RAIL_W, y: bodyY, width: width + RAIL_W, height }
    page = pagePresent ? { x: 0, y: bodyY, width: winW - width - RAIL_W, height } : null
  } else {
    // overlay：page 保持与收起态相同，rail 覆盖在 page 右侧。
    rail = { x: winW - width - RAIL_W, y: bodyY, width: width + RAIL_W, height }
    page = pagePresent ? { x: 0, y: bodyY, width: winW - RAIL_W, height } : null
  }

  const entry: Bounds | null =
    mode === 'entry' ? { x: 0, y: bodyY, width: winW - RAIL_W, height } : null

  return { chrome, entry, rail, page }
}

/** 入口表面几何（entry 模式；供 debug/兼容调用）。 */
export function computeEntryBounds({
  winW,
  winH,
  mode = 'entry',
}: {
  winW: number
  winH: number
  mode?: ShellMode
}): Bounds {
  const y = chromeHeight(mode)
  return { x: 0, y, width: winW - RAIL_W, height: winH - y }
}
