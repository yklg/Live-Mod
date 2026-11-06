// 壳窗口生命周期唯一归属（browser-shell-formalization-plan v3 · A1）
// 窗口创建/销毁/弹窗子窗口/F5 崩溃重建都在本层；driver 层只做寻址，不得 import Electron UI API。
// Phase 2：LM_SHELL_UI=1 时 open() 委托 shellUI 容器创建 pageView（单窗口形态），会话层无感。
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { createLogger } from '#/logger'
import { installExternalProtocolGuard } from './externalProtocolGuard'
import { preventPageInitiatedClose } from './pageCloseGuard'
import { classifyPopup } from './popupPolicy'
import { accountTabPartition } from './shellTabManager'
import { ensureAccountTab, isShellUIEnabled } from './shellUI'
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
  open(accountId: string, opts?: { popupOrigins?: readonly string[] }): ShellHandle {
    const nonce = `lm-nonce-${accountId}-${randomUUID()}`

    // Phase 2 单窗口形态（光圈式）：账号 Tab 承载官方页（UA/弹窗流/防自杀 handler 已在 shellUI 配置）
    if (isShellUIEnabled()) {
      const handle = ensureAccountTab(accountId, opts)
      logger.success('壳 pageView Tab 已打开（单窗口模式），目标账号：', accountId)
      return handle
    }

    const win = new BrowserWindow({
      title: `Live Mod 壳窗口 - ${accountId}`,
      width: 1280,
      height: 800,
      show: true,
      webPreferences: {
        // 壳窗口独立配置（v4 评审 P1）：独立 partition 持久化登录态、隔离上下文、无 preload——
        // 禁止复用主窗口 webPreferences，避免把 IPC 面暴露给官方远程页
        // partition 名与 tabManager/resetLoginState 同源（TC-P6 防线）
        partition: accountTabPartition(accountId),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    win.webContents.setUserAgent(chromeUa())
    // 与 view 档同口径：外部协议/深链导航拦截（防 macOS 系统弹窗）
    installExternalProtocolGuard(win.webContents, msg => logger.warn(msg))

    // 弹窗流规则（popupPolicy window 档）：同 host+path 自复制逃逸 = framebuster → deny；
    // 其余业务/外链弹窗 → allow（Phase 1 launched 语义行为锚，适配器 waitForEvent('page') 契约）。
    // A3：本档与 shellUI 的 view 档策略不同是平台约束驱动——view 上 allow 会销毁 webContents
    // （三轮实测），BrowserWindow 无此问题。Phase 3 末裁决"窗口模式退役"前禁止两档"统一化"误改。
    win.webContents.setWindowOpenHandler(({ url }) => {
      const decision = classifyPopup({
        currentUrl: win.webContents.getURL(),
        popupUrl: url,
        carrier: 'window',
      })
      if (decision === 'deny-selfdup') {
        logger.info(
          'popup-rule=deny-selfdup 拒绝自复制弹窗（反嵌入逃逸模式），页面留在壳内：',
          url.slice(0, 80),
        )
        return { action: 'deny' }
      }
      logger.info('popup-rule=allow(launched) 弹窗流→子窗口（保持 launched 语义）：', url)
      return { action: 'allow' }
    })
    // 子窗口 UA 对齐（window.open 子窗口默认带 Electron UA，会破坏风控基线）
    win.webContents.on('did-create-window', child => {
      child.webContents.setUserAgent(chromeUa())
    })
    // 拒绝页面发起的自杀（window.close()）——会话主体壳窗口永不因页面自杀而死；用户点 X 不受影响
    preventPageInitiatedClose(win.webContents, m => logger.warn(m))
    // 双保险（与 view 模式一致）：禁用页面 window.close，还原 Chrome 对非脚本打开窗口的忽略语义
    win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript('window.close = function () {};').catch(() => {})
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
