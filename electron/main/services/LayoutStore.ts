// 壳布局记忆持久化（userData/shell-layout.json）· v2
// v1 → v2：panelWidth→dockWidth（钳 320–420）、panelOpen→dockOpen；routeId 保留。
// mode 不持久化（启动由 autoRestore 决定）。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { isKnownShellRouteId, type ShellRouteId } from 'shared/shellRoutes'
import { clampDockWidth, DOCK_W } from '#/windows/shellLayout'

export const LAYOUT_STORE_FILE = 'shell-layout.json'
export const LAYOUT_STORE_VERSION = 2

export interface LayoutState {
  version: number
  dockWidth: number
  dockOpen: boolean
  routeId: ShellRouteId | null
}

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  version: LAYOUT_STORE_VERSION,
  dockWidth: DOCK_W,
  dockOpen: false,
  routeId: null,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseRouteId(value: unknown): ShellRouteId | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return isKnownShellRouteId(value) ? value : null
}

/**
 * 严格解析：v2 优先；v1 做一次性映射。非法 JSON/未知版本/字段类型 → null。
 * 损坏字段不吞成默认；调用方 loadLayoutState 负责回默认。
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
  const version = data.version
  const routeId = parseRouteId(data.routeId)
  if (routeId === undefined) return null

  if (version === 2) {
    const { dockWidth, dockOpen } = data
    if (typeof dockWidth !== 'number' || !Number.isFinite(dockWidth)) return null
    if (typeof dockOpen !== 'boolean') return null
    return {
      version: LAYOUT_STORE_VERSION,
      dockWidth: clampDockWidth(dockWidth),
      dockOpen,
      routeId,
    }
  }

  // v1 兼容：panelWidth/panelOpen
  if (version === 1) {
    const { panelWidth, panelOpen } = data
    if (typeof panelWidth !== 'number' || !Number.isFinite(panelWidth)) return null
    if (typeof panelOpen !== 'boolean') return null
    const mappedWidth = panelWidth > 0 ? panelWidth : DOCK_W
    return {
      version: LAYOUT_STORE_VERSION,
      dockWidth: clampDockWidth(mappedWidth),
      dockOpen: panelOpen,
      routeId,
    }
  }

  return null
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
  opts: { path?: string; writeFile?: (p: string, d: string) => void } = {},
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
