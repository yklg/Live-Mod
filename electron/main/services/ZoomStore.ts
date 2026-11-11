// 壳内页面缩放记忆持久化（userData/shell-zoom.json）
// 模式与 EntryStore 一致：纯 parse/serialize + fs 可注入 + 异常兜底（记忆丢失不阻断浏览）。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { clampZoom, ZOOM_DEFAULT } from '#/windows/pageZoom'

export const ZOOM_STORE_FILE = 'shell-zoom.json'
export const ZOOM_MEMORY_VERSION = 1

export interface ZoomMemory {
  version: number
  /** host → factor（仅记录非默认值，避免文件膨胀） */
  byHost: Record<string, number>
}

const EMPTY: ZoomMemory = { version: ZOOM_MEMORY_VERSION, byHost: {} }

export function parseZoomMemory(raw: string | null): ZoomMemory {
  if (!raw) return { ...EMPTY, byHost: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<ZoomMemory>
    if (!parsed || parsed.version !== ZOOM_MEMORY_VERSION || typeof parsed.byHost !== 'object') {
      return { ...EMPTY, byHost: {} }
    }
    const byHost: Record<string, number> = {}
    for (const [host, factor] of Object.entries(parsed.byHost ?? {})) {
      if (typeof factor === 'number' && Number.isFinite(factor)) byHost[host] = clampZoom(factor)
    }
    return { version: ZOOM_MEMORY_VERSION, byHost }
  } catch {
    return { ...EMPTY, byHost: {} }
  }
}

export function serializeZoomMemory(memory: ZoomMemory): string {
  return JSON.stringify(memory, null, 2)
}

export function getZoomStorePath(): string {
  return path.join(app.getPath('userData'), ZOOM_STORE_FILE)
}

export interface ZoomStoreIo {
  path?: string
  readFile?: (p: string) => string | null
  writeFile?: (p: string, data: string) => void
}

function readMemory(opts?: ZoomStoreIo): ZoomMemory {
  const p = opts?.path ?? getZoomStorePath()
  try {
    const raw = (
      opts?.readFile ?? (file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null))
    )(p)
    return parseZoomMemory(raw)
  } catch {
    return { ...EMPTY, byHost: {} }
  }
}

/**
 * 读取 host 的记忆缩放。
 * `defaultFactor` 是该站点的默认值（平台层提供，如中控台 0.8）：
 * 未记录时返回它；不传则回落到通用默认 1。
 */
export function loadZoomFactor(
  host: string,
  opts?: ZoomStoreIo,
  defaultFactor: number = ZOOM_DEFAULT,
): number {
  const factor = readMemory(opts).byHost[host]
  return typeof factor === 'number' ? factor : clampZoom(defaultFactor)
}

/**
 * 写入 host 的缩放记忆。
 * 与站点默认值相同 → 删除该 host（未手动缩放的站点不写文件）。
 */
export function saveZoomFactor(
  host: string,
  factor: number,
  opts?: ZoomStoreIo,
  defaultFactor: number = ZOOM_DEFAULT,
): boolean {
  const p = opts?.path ?? getZoomStorePath()
  try {
    const memory = readMemory({ ...opts, path: p })
    const normalized = clampZoom(factor)
    if (normalized === clampZoom(defaultFactor)) delete memory.byHost[host]
    else memory.byHost[host] = normalized
    const write =
      opts?.writeFile ?? ((file: string, data: string) => fs.writeFileSync(file, data, 'utf8'))
    write(p, serializeZoomMemory(memory))
    return true
  } catch {
    return false
  }
}
