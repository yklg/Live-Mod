// 壳窗口生命周期唯一归属（browser-shell-formalization-plan v3 · A1）
// 窗口创建/销毁/弹窗子窗口/F5 崩溃重建都在本层；driver 层只做寻址，不得 import Electron UI API。
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { createLogger } from '#/logger'

const logger = createLogger('ShellWindow')

/** 用内嵌 Chromium 版本拼标准 Chrome UA，剥离 Electron/LiveMod 标识（PoC-1 实测 0% headless 的关键） */
export function chromeUa(): string {
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
}

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

    // 弹窗流壳化适配（Phase 1.5，真实平台验收暴露的根因修复）：
    // 官方未登录跳转模式为 window.open(登录页)+window.close(自己)，壳窗口是会话主体，
    // 弹窗+自杀会杀死会话。修复=弹窗折叠为同窗导航（对齐 launched 模式 page.goto(LOGIN_PAGE) 语义）
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.info('弹窗流→同窗导航：', url)
      win.webContents.loadURL(url).catch(err => logger.error('同窗导航失败：', err))
      return { action: 'deny' }
    })
    // 拒绝页面发起的自杀（window.close()）；用户点 X 不触发本事件，手动关闭不受影响
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
