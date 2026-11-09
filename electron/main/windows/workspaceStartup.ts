// 启动编排（第二期）：railReady 后决定工作台 / 自动进 live；一次性、幂等。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { SHELL_PLATFORM_CATALOG } from '#/platforms/catalog'
import { loadEntryMemory } from '#/services/EntryStore'
import windowManager from '#/windowManager'
import { shouldAutoRestore } from './entryIntent'
import { hideEntry, markRailReadyHandled } from './entryView'
import { shellWorkspaceModeSet } from './shellUI'

let handled = false

export function handleWorkspaceReady() {
  if (handled) return
  handled = true
  markRailReadyHandled()
  hideEntry()
  const platform = shouldAutoRestore(loadEntryMemory(), SHELL_PLATFORM_CATALOG)
  if (platform) {
    shellWorkspaceModeSet('live')
    windowManager.sendTo('ui', IPC_CHANNELS.shell.entryIntent, { platform, source: 'restore' })
    return
  }
  shellWorkspaceModeSet('workbench')
}

export function resetWorkspaceStartupForTest() {
  handled = false
}
