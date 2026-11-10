// 启动编排：railReady 后决定 entry / autoRestore live；5s 未握手进入 fallbackEntry 终态。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { SHELL_PLATFORM_CATALOG } from '#/platforms/catalog'
import { loadEntryMemory } from '#/services/EntryStore'
import windowManager from '#/windowManager'
import { shouldAutoRestore } from './entryIntent'
import type { ShellMode } from './shellLayout'
import type { SurfaceOptions } from './surfaceController'

const logger = createLogger('ShellEntryStartup')
const FALLBACK_MS = 5000

let applySurface: (mode: ShellMode, opts?: SurfaceOptions) => void = () => {}
let getMode: () => ShellMode = () => 'entry'
let handled = false
let railReady = false
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

export function configureEntryStartup(deps: {
  applySurface: (mode: ShellMode, opts?: SurfaceOptions) => void
  getMode?: () => ShellMode
}) {
  applySurface = deps.applySurface
  getMode = deps.getMode ?? (() => 'entry')
}

export function startEntryFallback() {
  clearFallbackTimer()
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null
    if (handled) return
    handled = true
    if (getMode() !== 'entry') {
      logger.info('railReady 前模式已变更：fallbackEntry 不覆盖当前表面')
      return
    }
    logger.warn(`railReady 握手超时（${FALLBACK_MS}ms）：进入 fallbackEntry 终态`)
    applySurface('entry')
  }, FALLBACK_MS)
  fallbackTimer.unref?.()
}

export function handleEntryReady() {
  railReady = true
  if (handled) return
  handled = true
  clearFallbackTimer()
  const platform = shouldAutoRestore(loadEntryMemory(), SHELL_PLATFORM_CATALOG)
  if (platform) {
    applySurface('live', { restoreDock: true })
    windowManager.sendTo('ui', IPC_CHANNELS.shell.entryIntent, {
      platform,
      source: 'restore',
    })
    logger.success('按记忆自动进入：', platform)
    return
  }
  if (getMode() !== 'entry') {
    logger.info('railReady 前模式已变更：保留当前表面，不回到 entry')
    return
  }
  applySurface('entry')
  logger.info('显示入口平台选择器')
}

export function isEntryRailReady() {
  return railReady
}

/** 窗口关闭/测试清理：停止 fallback，避免定时器打到已销毁视图。 */
export function stopEntryStartup() {
  handled = true
  clearFallbackTimer()
}

export function resetEntryStartupForTest() {
  handled = false
  railReady = false
  clearFallbackTimer()
}

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}
