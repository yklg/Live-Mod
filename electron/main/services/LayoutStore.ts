// 壳布局记忆持久化（userData/shell-layout.json）
// 模式与 EntryStore/ZoomStore 一致：纯 parse/serialize + fs 可注入 + 异常兜底。
// 边界：面板宽度只做 [PANEL_MIN, PANEL_MAX] 的静态钳制；窗口相关钳制在 shellLayout.clampPanelWidth。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { isKnownShellRouteId, type ShellRouteId } from 'shared/shellRoutes'
import { PANEL_MAX, PANEL_MIN, PANEL_W } from '#/windows/shellLayout'

export const LAYOUT_STORE_FILE = 'shell-layout.json'
export const LAYOUT_STORE_VERSION = 1

export interface LayoutState {
  version: number
  panelWidth: number
  panelOpen: boolean
  routeId: ShellRouteId | null
}

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  version: LAYOUT_STORE_VERSION,
  panelWidth: PANEL_W,
  panelOpen: false,
  routeId: null,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 严格解析：非法 JSON/版本/字段类型 → null；宽度越界做静态钳制；
 * 未知 routeId（含已退场的 ai）降级为 null，但不丢宽度/开合。
 */
export function parseLayoutState(raw: string | null): LayoutState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  const { version, panelWidth, panelOpen, routeId } = data
  if (version !== LAYOUT_STORE_VERSION) return null
  if (typeof panelWidth !== 'number' || !Number.isFinite(panelWidth)) return null
  if (typeof panelOpen !== 'boolean') return null
  if (routeId !== null && typeof routeId !== 'string') return null
  return {
    version: LAYOUT_STORE_VERSION,
    panelWidth: Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, panelWidth))),
    panelOpen,
    routeId: isKnownShellRouteId(routeId) ? routeId : null,
  }
}

export function serializeLayoutState(state: LayoutState): string {
  return JSON.stringify(state, null, 2)
}

export function getLayoutStorePath(): string {
  return path.join(app.getPath('userData'), LAYOUT_STORE_FILE)
}

const defaultReadFile = (filePath: string): string => fs.readFileSync(filePath, 'utf-8')
const defaultWriteFile = (filePath: string, data: string): void => {
  fs.writeFileSync(filePath, data, 'utf-8')
}

/** 读取布局：缺失/损坏/读异常 → 默认布局（不阻断启动）。 */
export function loadLayoutState(
  opts: { path?: string; readFile?: (p: string) => string | null } = {},
): LayoutState {
  try {
    const filePath = opts.path ?? getLayoutStorePath()
    const readFile = opts.readFile ?? defaultReadFile
    return parseLayoutState(readFile(filePath)) ?? { ...DEFAULT_LAYOUT_STATE }
  } catch {
    return { ...DEFAULT_LAYOUT_STATE }
  }
}

/** 写入布局：成功 true，任何异常 false（布局记忆丢失不阻断启动）。 */
export function saveLayoutState(
  state: LayoutState,
  opts: { path?: string; writeFile?: (p: string, data: string) => void } = {},
): boolean {
  try {
    const filePath = opts.path ?? getLayoutStorePath()
    const writeFile = opts.writeFile ?? defaultWriteFile
    const normalized = parseLayoutState(serializeLayoutState(state)) ?? DEFAULT_LAYOUT_STATE
    writeFile(filePath, serializeLayoutState(normalized))
    return true
  } catch {
    return false
  }
}
