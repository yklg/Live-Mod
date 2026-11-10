// 平台选择意图（无视图）：entry 目录快照/选择/记忆只依赖本模块。
// 入口视图已退场；连接编排仍在 rail 业务树（单一连接通道）。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { findCatalogEntry, SHELL_PLATFORM_CATALOG } from '#/platforms/catalog'
import { loadEntryMemory, saveEntryMemory } from '#/services/EntryStore'
import windowManager from '#/windowManager'
import { type EntrySelectionResult, makeEntryMemory, resolveEntrySelection } from './entryIntent'
import { isEntryRailReady } from './entryStartup'

const logger = createLogger('ShellEntry')

export interface EntryMemorySnapshot {
  platform: LiveControlPlatform | null
  autoRestore: boolean
}

/** 工作台平台卡/入口快照：目录 + 记忆态（记忆损坏/平台下架降级为无记忆）。 */
export function getEntryCatalogSnapshot(): {
  platforms: ShellPlatformEntry[]
  remembered: EntryMemorySnapshot
} {
  const memory = loadEntryMemory()
  if (!memory) {
    return {
      platforms: [...SHELL_PLATFORM_CATALOG],
      remembered: { platform: null, autoRestore: true },
    }
  }
  const supported = findCatalogEntry(memory.lastPlatform)
  return {
    platforms: [...SHELL_PLATFORM_CATALOG],
    remembered: {
      platform: supported ? (memory.lastPlatform as LiveControlPlatform) : null,
      autoRestore: memory.autoRestore,
    },
  }
}

/** 平台选择唯一写路径：校验 → 落记忆 → 派发 intent（连接在 rail 业务树）。 */
export function selectEntry(
  platform: string,
  remember: boolean,
  shellUiEnabled: boolean,
): EntrySelectionResult {
  const result = resolveEntrySelection(platform, SHELL_PLATFORM_CATALOG, shellUiEnabled)
  if (!result.ok) {
    logger.warn('平台选择被拒绝：', platform, '理由：', result.reason)
    return result
  }
  if (!isEntryRailReady()) {
    logger.warn('平台选择被拒绝：壳容器尚未就绪')
    return { ok: false, reason: 'shell-not-ready' }
  }
  saveEntryMemory(makeEntryMemory(result.entry.id, remember))
  windowManager.sendTo('ui', IPC_CHANNELS.shell.entryIntent, {
    platform: result.entry.id,
    source: 'manual',
  })
  logger.success('平台选择已派发：', result.entry.id, '记住：', remember)
  return result
}

/** 记住开关即时落盘：只改 autoRestore；无历史记忆时 no-op（下次仍无记忆 → 选择器）。 */
export function setEntryRemember(autoRestore: boolean | null): boolean {
  if (typeof autoRestore !== 'boolean') return false
  const memory = loadEntryMemory()
  if (!memory) return true
  return saveEntryMemory({
    ...memory,
    autoRestore,
    updatedAt: new Date().toISOString(),
  })
}
