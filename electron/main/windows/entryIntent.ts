// 壳入口意图裁决纯函数（shell-entry-platform-selector v1 · Proposed Changes 2）——零 Electron import。
// 职责边界（架构铁律）：
//   - 本模块只做「选择是否合法」+「记忆是否可自动恢复」两件事，不落盘、不派发、不连接；
//   - 目录由调用方注入（唯一真源仍是 platforms/catalog），本模块不 import 目录，测试可用替身目录证明无写死；
//   - 持久化归 services/EntryStore；连接编排归 rail 业务树（单一连接通道）。
// 测试锚：entryIntent.test.ts 两张决策表（选择 / 自动恢复）+ 零 Electron import 源码扫描。

/** 记忆 schema 版本：升级时旧版本记忆一律失效（选择器重新出现），不做隐式迁移 */
export const ENTRY_MEMORY_VERSION = 1

/** 入口选择失败理由（全部为可展示的稳定词表，IPC 原样回传 renderer） */
export type EntrySelectFailureReason =
  | 'unknown'
  | 'unsupported'
  | 'shell-disabled'
  | 'shell-not-ready'

export type EntrySelectionResult =
  | { ok: true; entry: ShellPlatformEntry }
  | { ok: false; reason: EntrySelectFailureReason }

/** 入口记忆：userData/shell-entry.json 的 schema（EntryStore 负责读写，本模块负责构造/裁决） */
export type EntryMemory = {
  version: number
  lastPlatform: string
  autoRestore: boolean
  updatedAt: string
}

/**
 * 入口选择唯一裁决（优先级：shell-disabled > unknown > unsupported）。
 * shell 关闭优先：入口视图本就不该存在，返回 shell-disabled 比平台校验结果更能说明失败边界。
 */
export function resolveEntrySelection(
  platform: string,
  catalog: readonly ShellPlatformEntry[],
  shellUiEnabled: boolean,
): EntrySelectionResult {
  if (!shellUiEnabled) return { ok: false, reason: 'shell-disabled' }
  const entry = catalog.find(item => item.id === platform)
  if (!entry) return { ok: false, reason: 'unknown' }
  if (!entry.attachSupported) return { ok: false, reason: 'unsupported' }
  return { ok: true, entry }
}

/** 构造记忆（now 注入保证测试可确定；默认当前时间，ISO 字符串便于日志/排障） */
export function makeEntryMemory(
  platform: string,
  autoRestore: boolean,
  now: Date = new Date(),
): EntryMemory {
  return {
    version: ENTRY_MEMORY_VERSION,
    lastPlatform: platform,
    autoRestore,
    updatedAt: now.toISOString(),
  }
}

/**
 * 自动恢复唯一裁决：命中返回 platform（供 rail 直接派发 restore intent），否则 null。
 * 命中条件（全部满足）：记忆非空 + 版本匹配 + autoRestore + 平台仍在目录且 attachSupported。
 * 任一不满足 → 视为无记忆（显示入口选择器），永不阻断启动。
 */
export function shouldAutoRestore(
  memory: EntryMemory | null,
  catalog: readonly ShellPlatformEntry[],
): LiveControlPlatform | null {
  if (!memory) return null
  if (memory.version !== ENTRY_MEMORY_VERSION) return null
  if (!memory.autoRestore) return null
  const entry = catalog.find(item => item.id === memory.lastPlatform)
  if (!entry?.attachSupported) return null
  return entry.id
}
