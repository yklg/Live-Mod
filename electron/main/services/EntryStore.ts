// 壳入口记忆持久化（shell-entry-platform-selector v1 · Proposed Changes 2）。
// 位置：userData/shell-entry.json；schema：{ version, lastPlatform, autoRestore, updatedAt }（EntryMemory）。
// 设计边界：
//   - 记忆丢失/损坏**永不阻断启动**：parse/load 返回 null、save 返回 false，全链路不抛；
//   - 读写与路径可注入：单测用替身 io 覆盖决策表，不依赖真实 userData，也不 mock 整个 fs；
//   - 版本不符视为无记忆（升级即失效，选择器重新出现），不做隐式迁移；
//   - 不 import 平台目录：持久化层不裁决「平台是否下架」，那是 entryIntent.shouldAutoRestore 的职责。
// 注意：本模块吞掉的只是"记忆文件"错误（记忆丢失非功能失败）；连接错误必须在连接层显式暴露，不得在此静默。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { ENTRY_MEMORY_VERSION, type EntryMemory } from '#/windows/entryIntent'

export const ENTRY_STORE_FILE = 'shell-entry.json'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 解析记忆：非法 JSON / 非对象 / 版本不符 / 任一字段缺失或类型不符 → null（不抛）。
 * 只保留 schema 内四字段（未知字段丢弃，避免旧/脏数据渗透到调用方）。
 */
export function parseEntryMemory(raw: string | null): EntryMemory | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  const { version, lastPlatform, autoRestore, updatedAt } = data
  if (version !== ENTRY_MEMORY_VERSION) return null
  if (typeof lastPlatform !== 'string' || lastPlatform.length === 0) return null
  if (typeof autoRestore !== 'boolean') return null
  if (typeof updatedAt !== 'string' || updatedAt.length === 0) return null
  return { version, lastPlatform, autoRestore, updatedAt }
}

/** 序列化为落盘文本（2 空格缩进，便于人工排障；parse 不依赖缩进） */
export function serializeEntryMemory(memory: EntryMemory): string {
  return JSON.stringify(memory, null, 2)
}

/** 记忆文件唯一路径（userData 由 Electron 保证存在；不可用时的异常由 load/save 兜底为 null/false） */
export function getEntryStorePath(): string {
  return path.join(app.getPath('userData'), ENTRY_STORE_FILE)
}

const defaultReadFile = (filePath: string): string => fs.readFileSync(filePath, 'utf-8')
const defaultWriteFile = (filePath: string, data: string): void => {
  fs.writeFileSync(filePath, data, 'utf-8')
}

/**
 * 读取入口记忆：文件不存在/权限失败/内容损坏 → null（视为无记忆，启动继续走入口选择器）。
 * opts 注入仅用于测试与受限环境；生产调用 loadEntryMemory() 使用默认 fs 实现。
 */
export function loadEntryMemory(
  opts: { path?: string; readFile?: (p: string) => string | null } = {},
): EntryMemory | null {
  try {
    const filePath = opts.path ?? getEntryStorePath()
    const readFile = opts.readFile ?? defaultReadFile
    return parseEntryMemory(readFile(filePath))
  } catch {
    return null
  }
}

/**
 * 写入入口记忆：成功 true，任何异常 false（记忆丢失非功能失败，调用方不得因此阻断连接/启动）。
 * opts 注入仅用于测试与受限环境；生产调用 saveEntryMemory(memory) 使用默认 fs 实现。
 */
export function saveEntryMemory(
  memory: EntryMemory,
  opts: { path?: string; writeFile?: (p: string, data: string) => void } = {},
): boolean {
  try {
    const filePath = opts.path ?? getEntryStorePath()
    const writeFile = opts.writeFile ?? defaultWriteFile
    writeFile(filePath, serializeEntryMemory(memory))
    return true
  } catch {
    return false
  }
}
