// utils/windowManager.js
import type { BrowserWindow, WebContents } from 'electron'
import type { IpcChannels } from 'shared/electron-api'

class WindowManager {
  private mainWindow?: BrowserWindow
  /** 壳容器模式（Phase 2）：React 应用迁移至 panelView，main→renderer 推送改路由到其 webContents */
  private uiTarget?: WebContents

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win

    // 自动清理引用
    win.on('closed', () => {
      this.mainWindow = undefined
    })
  }

  setUITarget(wc: WebContents) {
    this.uiTarget = wc
  }

  clearUITarget() {
    this.uiTarget = undefined
  }

  send<Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): boolean {
    const target =
      this.uiTarget && !this.uiTarget.isDestroyed()
        ? this.uiTarget
        : this.mainWindow && !this.mainWindow.isDestroyed()
          ? this.mainWindow.webContents
          : undefined
    if (!target) return false
    target.send(channel, ...args)
    return true
  }
}

export default new WindowManager()
