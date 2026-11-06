// utils/windowManager.js
import type { BrowserWindow, WebContents } from 'electron'
import type { IpcChannels } from 'shared/electron-api'

/** 具名推送目标（A4：显式路由，无通道前缀魔法字符串） */
export type PushTarget = 'ui' | 'chrome' | 'notice'

class WindowManager {
  private mainWindow?: BrowserWindow
  /** 壳容器模式（Phase 2）：React 应用迁移出主窗口 webContents，main→renderer 推送改路由到具名目标。
   *  ui = 业务树（v3 分栏 panelView / 光圈式 railView）；chrome = 壳顶栏入口；
   *  notice = 壳级通知覆盖层（shell-ui-polish v3，全窗透明 HUD）。 */
  private targets: Partial<Record<PushTarget, WebContents>> = {}

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win

    // 自动清理引用
    win.on('closed', () => {
      this.mainWindow = undefined
    })
  }

  setUITarget(wc: WebContents) {
    this.targets.ui = wc
  }

  setTarget(name: PushTarget, wc: WebContents) {
    this.targets[name] = wc
  }

  clearUITarget() {
    this.targets = {}
  }

  send<Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): boolean {
    return this.sendTo('ui', channel, ...args)
  }

  sendTo<Channel extends keyof IpcChannels>(
    target: PushTarget,
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): boolean {
    const named = this.targets[target]
    const resolved =
      named && !named.isDestroyed()
        ? named
        : target === 'ui' && this.mainWindow && !this.mainWindow.isDestroyed()
          ? this.mainWindow.webContents
          : undefined
    if (!resolved) return false
    resolved.send(channel, ...args)
    return true
  }
}

export default new WindowManager()
