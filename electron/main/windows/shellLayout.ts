// 壳布局几何唯一真源：纯函数，零 Electron import。
// 模式：entry（52px 顶栏，无左栏）/ live（52+36）/ browse（52+36+36）。
// 布局形态：overlay（浮层覆盖，默认）/ dock（让位，保留但默认不启用）。
// 约束：page bounds 只由本函数产出；overlay 下 page 永远满宽（面板浮在右侧，不挤占官方页）。
//
// 壳 v3 · Wave 2 变更（计划 §4.1）：
// - 删除右侧 56px 图标条（D4）：rail 视图自此**只承载面板**。
// - rail 视图收起时宽度归零（width=0）而**不销毁**（§2 硬约束 2：railReady 握手依赖它存在）。
// - 新增 layoutMode：'overlay'（默认，浮层覆盖）/ 'dock'（让位，保留供未来开关/回滚）。
//   v2 把 dock 能力直接删掉，等于让「浮层↔dock」切换变成不可逆改写——这里做成选项。
// - PAGE_MIN 与 dockFits 只在 dock 分支被使用（overlay 不挤占官方页，无需门禁）。

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export type ShellMode = 'entry' | 'live' | 'browse'

/**
 * 布局形态：
 * - `overlay`：面板浮在页面右侧覆盖，page 宽度**不变**（默认，D2 决策）。
 * - `dock`：面板让出宽度，page 变窄（保留能力，默认不启用）。
 */
export type LayoutMode = 'overlay' | 'dock'

export interface ShellBounds {
  chrome: Bounds
  entry: Bounds | null
  rail: Bounds
  page: Bounds | null
}

export const TOPBAR_H = 52
export const BROWSER_BAR_H = 36
export const TABSTRIP_H = 36

export const DOCK_MIN = 320
export const DOCK_W = 360
export const DOCK_MAX = 420

export const PAGE_MIN = 640 // 官方页不重排的既有门禁（**仅 dock 分支使用**）

// live 模式总高（52 产品顶栏 + 36 工具条）；notice 等子窗口初始位置兼容用。
export const CHROME_H = TOPBAR_H + BROWSER_BAR_H

export function chromeHeight(mode: ShellMode): number {
  if (mode === 'entry') return TOPBAR_H
  if (mode === 'browse') return TOPBAR_H + BROWSER_BAR_H + TABSTRIP_H
  return TOPBAR_H + BROWSER_BAR_H
}

/**
 * dock 是否放得下：必须保住 pageView 的 PAGE_MIN，避免官方页重排。
 *
 * 仅 `layoutMode === 'dock'` 分支调用（overlay 不挤占 page，不需要这个门禁）。
 * 图标条已删除，rail 宽度就是 dock 宽度本身，因此这里不再扣图标条宽度。
 */
export function dockFits(winW: number, dockWidth: number = DOCK_W): boolean {
  return winW - dockWidth >= PAGE_MIN
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
  /** 布局形态：默认 overlay（浮层覆盖）；dock 保留但不启用。 */
  layoutMode?: LayoutMode
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
 * - entry：entry 覆盖页面区（满宽），page=null，dock 强制收起，rail 宽度 0。
 * - overlay（默认）：page 永远满宽；rail 收起时 width=0，打开时 width=dock 宽度（浮在右侧）。
 * - dock（保留）：page 让出 dock 宽度（需放得下），否则退回 overlay。
 */
export function computeShellBounds({
  winW,
  winH,
  mode = 'live',
  layoutMode = 'overlay',
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

  let rail: Bounds
  let page: Bounds | null
  if (!open) {
    // 收起：rail 宽度归零（视图保留不销毁，见文件头硬约束）
    rail = { x: winW, y: bodyY, width: 0, height }
    page = pagePresent ? { x: 0, y: bodyY, width: winW, height } : null
  } else if (layoutMode === 'dock' && dockFits(winW, width)) {
    // dock 形态（保留，默认不启用）：page 让出 dock 宽度
    rail = { x: winW - width, y: bodyY, width, height }
    page = pagePresent ? { x: 0, y: bodyY, width: winW - width, height } : null
  } else {
    // overlay（默认）：page 保持满宽，rail 浮在页面右侧覆盖
    rail = { x: winW - width, y: bodyY, width, height }
    page = pagePresent ? { x: 0, y: bodyY, width: winW, height } : null
  }

  const entry: Bounds | null =
    mode === 'entry' ? { x: 0, y: bodyY, width: winW, height } : null

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
  return { x: 0, y, width: winW, height: winH - y }
}
