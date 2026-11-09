// 壳承载体生命周期唯一归属（browser-shell-formalization-plan v3 · A1）
// 会话页/辅助页的创建与销毁都在本层；driver 层只做寻址，不得 import Electron UI API。
// 壳 UI 是唯一运行形态：open() 委托 shellUI 容器创建 pageView（单窗口 Tab），会话层无感；
// 经典模式的独立 BrowserWindow 窗口档已随经典模式一并移除（其 attach 登录链路的子窗生命周期缺陷
// 参见 v1.9.0 CHANGELOG：allow 子窗口随 opener 关闭，导致登录弹窗页 Target closed → 降级 launch）。
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { createLogger } from '#/logger'
import { installExternalProtocolGuard } from './externalProtocolGuard'
import { accountTabPartition } from './shellTabManager'
import { ensureAccountTab } from './shellUI'
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

  /** 建账号 Tab 并导航到 nonce 标记页（P0-2 规程：先 about:blank#nonce，寻址成功后由会话层 goto） */
  open(accountId: string, opts?: { popupOrigins?: readonly string[] }): ShellHandle {
    // 壳 UI 是唯一运行形态：账号页由壳内 Tab（WebContentsView）承载，
    // 官方页的弹窗流/UA/防自杀 handler 已在 shellUI 的 view 档配置。
    const handle = ensureAccountTab(accountId, opts)
    logger.success('壳 pageView Tab 已打开（单窗口模式），目标账号：', accountId)
    return handle
  }

  /**
   * 辅助页承载体（fix-shell-popup-navigation-liveend A4）：补偿 attached 会话缺失的「新建页面」能力——
   * 壳 UI 里会话页是 pageView，CDP 的 `Target.createTarget` 对 WebContentsView 不受支持，
   * `context.newPage()` 在 attach 下必然失败（seamless-fix §C）。这里用**隐藏 BrowserWindow**
   * 新建一个独立 target：同 partition（登录态一致）+ 同 UA 基线，再交给 pageFactory 按 nonce 寻址。
   *
   * 用途：罗盘直播大屏等「只被 app 监听、不需要用户看见」的辅助页（CompassListener/视频号）。
   * 注意：show:false 的窗口在 Chromium 属后台页，定时器/动画会被节流，故**不得**承载需要正常
   * 渲染节奏的业务页；关闭由调用方持有 disposeWindow 负责（会话层 createAuxPage 已接住）。
   */
  openAux(accountId: string): ShellHandle {
    const nonce = `lm-aux-nonce-${accountId}-${randomUUID()}`
    const win = new BrowserWindow({
      title: `Live Mod 辅助页 - ${accountId}`,
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        // 与窗口档同口径（v4 评审 P1）：独立 partition 持久化登录态、隔离上下文、无 preload
        partition: accountTabPartition(accountId),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    win.webContents.setUserAgent(chromeUa())
    installExternalProtocolGuard(win.webContents, msg => logger.warn(msg))
    // 辅助页同样是远程官方页：禁止它再开新窗口（否则会冒出壳层无法管理的原生窗口）
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // 兜底：辅助页的消费者（如 CompassListener）以 page.close() 销毁 target 结束使用，
    // 若 webContents 先销毁而窗口未关，这里补关窗口——避免不可见的隐藏窗口长期残留占资源。
    win.webContents.once('destroyed', () => {
      if (!win.isDestroyed()) win.close()
    })
    win.once('closed', () => {
      this.windows.delete(win.id)
      logger.info('辅助页窗口已关闭', win.id)
    })

    this.windows.set(win.id, win)
    // 与壳窗口同规程（P0-2）：先 about:blank#nonce 标记页，寻址成功后由调用方 goto 目标 URL
    win.loadURL(`about:blank#${nonce}`).catch(err => logger.error('辅助页 nonce 页加载失败：', err))

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
