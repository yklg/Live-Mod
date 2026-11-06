// 壳窗口生命周期唯一归属（browser-shell-formalization-plan v3 · A1）
// 窗口创建/销毁/弹窗子窗口/F5 崩溃重建都在本层；driver 层只做寻址，不得 import Electron UI API。
// Phase 2：LM_SHELL_UI=1 时 open() 委托 shellUI 容器创建 pageView（单窗口形态），会话层无感。
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { createLogger } from '#/logger'
import { isShellUIEnabled, openPageView } from './shellUI'
import { chromeUa } from './ua'

const logger = createLogger('ShellWindow')

export interface ShellHandle {
  /** 完整 nonce（不含 #），交给 pageFactory 精确寻址 */
  nonce: string
  windowId: number
  /** F1 超时时由寻址方调用，保证窗口不泄漏 */
  disposeWindow: () => Promise<void>
}

class ShellWindowManager {
  private windows = new Map<number, BrowserWindow>()

  /** 建壳窗口并导航到 nonce 标记页（P0-2 规程：先 about:blank#nonce，寻址成功后由会话层 goto） */
  open(accountId: string): ShellHandle {
    const nonce = `lm-nonce-${accountId}-${randomUUID()}`

    // Phase 2 单窗口形态：pageView 承载官方页（UA/弹窗流/防自杀 handler 已在 shellUI 内配置）
    if (isShellUIEnabled()) {
      const { webContents, disposeWindow } = openPageView(accountId)
      webContents
        .loadURL(`about:blank#${nonce}`)
        .catch(err => logger.error('nonce 页加载失败：', err))
      logger.success('壳 pageView 已打开（单窗口模式），目标账号：', accountId)
      return { nonce, windowId: webContents.id, disposeWindow }
    }

    const win = new BrowserWindow({
      title: `Live Mod 壳窗口 - ${accountId}`,
      width: 1280,
      height: 800,
      show: true,
      webPreferences: {
        // 壳窗口独立配置（v4 评审 P1）：独立 partition 持久化登录态、隔离上下文、无 preload——
        // 禁止复用主窗口 webPreferences，避免把 IPC 面暴露给官方远程页
        partition: `persist:lm-shell-${accountId}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    win.webContents.setUserAgent(chromeUa())

    // 弹窗流壳化适配（Phase 1.5 二轮修正，真实平台验收暴露）：
    // 保持 allow——弹窗子窗口在 attach 模式下会作为 context 新 page 出现，
    // 满足 BuyinPlatform.login 的 context.waitForEvent('page') 契约（与 launched 模式同语义）。
    // Electron 与 Chrome 的策略差异在"页面可关闭非脚本打开的窗口"，由下方 did-request-close 守卫还原。
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.info('弹窗流→子窗口（保持 launched 语义）：', url)
      return { action: 'allow' }
    })
    // 子窗口 UA 对齐（window.open 子窗口默认带 Electron UA，会破坏风控基线）
    win.webContents.on('did-create-window', child => {
      child.webContents.setUserAgent(chromeUa())
    })
    // 拒绝页面发起的自杀（window.close()）——会话主体壳窗口永不因页面自杀而死；用户点 X 不受影响
    win.webContents.on('did-request-close', e => {
      logger.warn('已拒绝页面发起的壳窗口关闭（保会话主体存活）')
      e.preventDefault()
    })

    win.once('closed', () => {
      this.windows.delete(win.id)
      logger.info('壳窗口已关闭', win.id)
    })

    this.windows.set(win.id, win)
    win.loadURL(`about:blank#${nonce}`).catch(err => logger.error('nonce 页加载失败：', err))

    return {
      nonce,
      windowId: win.id,
      disposeWindow: async () => {
        const w = this.windows.get(win.id)
        this.windows.delete(win.id)
        if (w && !w.isDestroyed()) w.close()
      },
    }
  }

  get(windowId: number): BrowserWindow | undefined {
    return this.windows.get(windowId)
  }
}

export const shellWindowManager = new ShellWindowManager()
