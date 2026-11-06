// 壳入口平台选择器视图（shell-entry-platform-selector v1）
// 职责（架构边界）：
//   - 入口视图生命周期（创建/显隐/加载/销毁）与启动编排（记忆命中→自动派发 / 否则显示入口）
//   - 选择动作的**校验 + 记忆落盘 + 派发意图**；不执行连接（连接编排在 rail 完整业务树，单一通道）
//   - 不持有几何（bounds 由 shellUI 用 computeEntryBounds 唯一真源下发）
// 安全边界：入口是本地受信入口视图（同 chrome，带 preload），**不是 pageView**；页面只准用 shell:* 通道。
// 层级铁律（P0-2 更新）：page(0) < entry(1) < chrome(2) < rail(3)。
import type { BrowserWindow, WebContentsView } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { findCatalogEntry, SHELL_PLATFORM_CATALOG } from '#/platforms/catalog'
import { loadEntryMemory, saveEntryMemory } from '#/services/EntryStore'
import windowManager from '#/windowManager'
import {
  type EntrySelectionResult,
  makeEntryMemory,
  resolveEntrySelection,
  shouldAutoRestore,
} from './entryIntent'
import type { Bounds } from './shellLayout'
import { loadAppEntry, makeAppView } from './viewHost'

const logger = createLogger('ShellEntry')

/** rail 完整树就绪握手兜底（防 rail 加载失败导致入口永不显示——防御性路径必须留日志） */
const RAIL_READY_TIMEOUT_MS = 5000

let entryView: WebContentsView | null = null
let visible = false
/** 入口页面是否已加载完成：未完成时 show 请求挂起，避免用户看到空白入口（首帧后才露面） */
let loaded = false
let pendingShow = false
let railReadyHandled = false
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

export interface EntryMemorySnapshot {
  platform: LiveControlPlatform | null
  autoRestore: boolean
}

/** shellUI.attachContainer 调用：挂到容器 index 1（page 与 chrome 之间），初始隐藏等待 rail 就绪 */
export function attachEntryView(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  // append 挂载：由 shellUI 控制「entry → chrome → rail」顺序，pageView 再 mount 到 index 0，
  // 最终 [page(0), entry(1), chrome(2), rail(3)]（P0-2 v1）
  entryView = makeAppView(preloadPath)
  win.contentView.addChildView(entryView)
  entryView.setVisible(false)
  visible = false
  loaded = false
  pendingShow = false
  entryView.webContents.once('did-finish-load', () => {
    loaded = true
    if (pendingShow) {
      pendingShow = false
      showEntry()
    }
  })
  loadAppEntry(entryView, entry, 'entry')
  fallbackTimer = setTimeout(() => {
    if (railReadyHandled) return
    railReadyHandled = true
    logger.warn(`railReady 握手超时（${RAIL_READY_TIMEOUT_MS}ms）：兜底显示入口选择器`)
    showEntry()
  }, RAIL_READY_TIMEOUT_MS)
  fallbackTimer.unref?.()
  logger.info('入口视图已挂载（初始隐藏，等待 rail 就绪）')
}

export function relayoutEntryView(bounds: Bounds | null) {
  entryView?.setBounds(bounds ?? { x: 0, y: 0, width: 0, height: 0 })
}

export function isEntryVisible() {
  return visible
}

export function showEntry() {
  if (!entryView) return
  if (!loaded) {
    // 首帧未就绪：挂起展示请求，加载完成后再显示（入口不留白屏）
    pendingShow = true
    return
  }
  entryView.setVisible(true)
  visible = true
}

/** 幂等隐藏；连接开始/成功时由 connection IPC 调用（任何连接入口都让位给壳内 Tab） */
export function hideEntry() {
  visible = false
  entryView?.setVisible(false)
}

export function destroyEntryView() {
  clearFallbackTimer()
  const view = entryView
  entryView = null
  visible = false
  loaded = false
  pendingShow = false
  railReadyHandled = false
  try {
    view?.webContents.close()
  } catch (error) {
    logger.warn('入口视图销毁失败（窗口关闭路径，忽略）：', error)
  }
}

/** 面板「切换平台」：未连接时重新显示入口（开合状态仍归 panelController，本函数只改入口显隐） */
export function reopenEntry() {
  showEntry()
}

/**
 * rail 就绪握手（rail 树 mount 后 invoke）——启动编排唯一入口，幂等：
 * 命中记忆 → 保持隐藏并派发 restore intent（rail 自动连接）；否则显示入口选择器。
 */
export function handleRailReady() {
  if (railReadyHandled) return
  railReadyHandled = true
  clearFallbackTimer()

  const platform = shouldAutoRestore(loadEntryMemory(), SHELL_PLATFORM_CATALOG)
  if (platform) {
    hideEntry()
    windowManager.sendTo('ui', IPC_CHANNELS.shell.entryIntent, { platform, source: 'restore' })
    logger.success('按记忆自动进入：', platform)
    return
  }
  showEntry()
  logger.info('显示入口平台选择器')
}

/**
 * 入口选择（纯展示层唯一写路径）：校验 → 落记忆 → 隐藏入口 → 派发 manual intent。
 * 返回给渲染层用于失败提示；真正的连接在 rail 业务树（单一连接通道）。
 */
export function selectEntry(
  platform: string,
  remember: boolean,
  shellUiEnabled: boolean,
): EntrySelectionResult {
  const result = resolveEntrySelection(platform, SHELL_PLATFORM_CATALOG, shellUiEnabled)
  if (!result.ok) {
    logger.warn('入口选择被拒绝：', platform, '理由：', result.reason)
    return result
  }
  // remember=false：仍记录"最后选择"但关闭自动进入（下次启动回到入口选择器）
  saveEntryMemory(makeEntryMemory(result.entry.id, remember))
  hideEntry()
  windowManager.sendTo('ui', IPC_CHANNELS.shell.entryIntent, {
    platform: result.entry.id,
    source: 'manual',
  })
  logger.success('入口选择已派发：', result.entry.id, '记住：', remember)
  return result
}

/** 入口渲染首屏用：目录快照 = 平台目录 + 记忆态（记忆文件损坏/平台下架一律降级为无记忆） */
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

export function getEntryDebug() {
  return {
    visible,
    url: entryView?.webContents.getURL() ?? '',
    bounds: entryView?.getBounds() ?? null,
  }
}

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}
