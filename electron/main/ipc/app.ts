import { app, BrowserWindow, shell } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { accountManager } from '#/managers/AccountManager'
import { providerService } from '#/services/ProviderService'
import { typedIpcMainHandle } from '#/utils'

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.chrome.toggleDevTools, event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })

  typedIpcMainHandle(IPC_CHANNELS.app.openLogFolder, () => {
    shell.openPath(app.getPath('logs'))
  })

  typedIpcMainHandle(IPC_CHANNELS.app.openExternal, (_, url: string) => {
    shell.openExternal(url)
  })

  typedIpcMainHandle(IPC_CHANNELS.app.getProviders, () => {
    return providerService.providers
  })

  typedIpcMainHandle(IPC_CHANNELS.account.switch, (_, { account }) => {
    accountManager.setAccountName(account.id, account.name)
    // 单窗口壳形态（Phase 2.3）：换挂 active pageView；经典模式下为无害空操作
    void import('#/windows/shellUI').then(m => m.setActiveAccount(account.id))
  })
}

export function setupAppIpcHandlers() {
  setupIpcHandlers()
}
