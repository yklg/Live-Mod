// 单窗口壳形态容器（Phase 2，LM_SHELL_UI=1 启用；browser-shell-formalization-plan v3 §Phase 2）
// 承载体修订（v2）：pageView 采用容器附属的 frameless 子 BrowserWindow——
// 实测 WebContentsView 无法承载官方页的弹窗/自关闭语义（allow 弹窗瞬间 view 的
// webContents 被销毁，did-request-close 与 preload 守卫均无法介入），而 BrowserWindow
// 语义已在 Phase 1 窗口模式实测存活。子窗口跟随父窗移动/缩放，视觉仍为嵌入单窗。
// 主窗口 = 壳容器：panelView(WebContentsView, React 应用迁移) + 左侧子窗口(官方页，attach 目标)。
// 关闭容器=退出；关 pageView 子窗口=会话拆除（页面自杀被守卫拒绝）。
import { BrowserWindow, shell, WebContentsView } from 'electron'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import { chromeUa } from './ua'

const logger = createLogger('ShellUI')

const PANEL_WIDTH = 460
let container: BrowserWindow | null = null
let panelView: WebContentsView | null = null
let activeAccountId: string | null = null
let enabled = false

const pageWindows = new Map<string, BrowserWindow>()

/** 弹窗 URL 与当前页同 host+pathname = 自复制（framebuster/反嵌入逃逸特征） */
function isSelfDuplication(currentUrl: string, popupUrl: string): boolean {
  try {
    const cur = new URL(currentUrl)
    const pop = new URL(popupUrl)
    return cur.host === pop.host && cur.pathname === pop.pathname
  } catch {
    return false
  }
}

export function isShellUIEnabled() {
  return enabled
}

/**
 * 绑定主窗口为壳容器：panelView 加载 React 应用（迁移，非并存——主窗口自身 webContents 不承载 UI）。
 * panelView 与主窗口共用 preload（window.ipcRenderer 契约不变）。
 */
export function attachContainer(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  enabled = true
  container = win

  panelView = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: process.env.NODE_ENV === 'development',
    },
  })
  win.contentView.addChildView(panelView)

  panelView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (entry.url) panelView.webContents.loadURL(entry.url)
  else if (entry.file) panelView.webContents.loadFile(entry.file)

  // windowManager 的 main→renderer 推送目标切到 panelView（React 应用现在住在 panelView）
  windowManager.setUITarget(panelView.webContents)

  win.on('resize', relayout)
  win.on('move', relayout)
  win.on('enter-full-screen', relayout)
  win.on('leave-full-screen', relayout)
  relayout()

  win.once('closed', () => {
    container = null
    panelView = null
    activeAccountId = null
    pageWindows.clear() // 子窗口随父窗口自动销毁
    enabled = false
    windowManager.clearUITarget()
  })

  logger.success('壳容器已绑定，panelView 已加载应用')
}

function relayout() {
  if (!container || container.isDestroyed()) return
  const [w, h] = container.getContentSize()
  const active = activeAccountId ? pageWindows.get(activeAccountId) : null

  if (active && !active.isDestroyed()) {
    const pw = Math.min(PANEL_WIDTH, Math.floor(w * 0.5))
    panelView?.setBounds({ x: w - pw, y: 0, width: pw, height: h })
    // 子窗口用屏幕坐标对齐容器内容区左侧
    const cb = container.getContentBounds()
    active.setBounds({ x: cb.x, y: cb.y, width: w - pw, height: h })
    if (!active.isVisible()) active.show()
  } else {
    panelView?.setBounds({ x: 0, y: 0, width: w, height: h })
  }

  for (const [id, win] of pageWindows) {
    if (id !== activeAccountId && !win.isDestroyed() && win.isVisible()) win.hide()
  }
}

/** 供 ShellWindowManager 在壳容器模式调用：创建/复用该账号的承载子窗口（attach 目标） */
export function openPageView(accountId: string): {
  webContents: BrowserWindow['webContents']
  disposeWindow: () => Promise<void>
} {
  if (!container || container.isDestroyed()) throw new Error('壳容器未就绪')

  let win = pageWindows.get(accountId)
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      parent: container,
      frame: false,
      show: false,
      movable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: `persist:lm-shell-${accountId}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.webContents.setUserAgent(chromeUa())
    // 弹窗流规则（15:04 实测：fxg 登录页对 Electron 环境有"自复制逃逸"反嵌入模式——
    // window.open 同 URL 副本后原页被替换销毁；did-request-close 不触发，非 close 语义）：
    // 自复制弹窗（同 host+pathname）= framebuster 特征 → deny；
    // 异 URL 业务弹窗（如 buyin 的 mpa/account/login）= 适配器 waitForEvent('page') 契约 → allow
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSelfDuplication(win.webContents.getURL(), url)) {
        logger.info('拒绝自复制弹窗（反嵌入逃逸模式），页面留在壳内：', url.slice(0, 80))
        return { action: 'deny' }
      }
      logger.info('pageView 业务弹窗→子窗口：', url)
      return { action: 'allow' }
    })
    win.webContents.on('did-create-window', child => {
      child.webContents.setUserAgent(chromeUa())
    })
    win.webContents.on('did-request-close', e => {
      logger.warn('已拒绝页面发起的 pageView 关闭（保会话载体存活）')
      e.preventDefault()
    })
    win.webContents.on('destroyed', () => logger.warn('pageView 子窗口 webContents 已销毁'))
    win.once('closed', () => {
      pageWindows.delete(accountId)
      if (activeAccountId === accountId) {
        activeAccountId = null
        relayout()
      }
    })
    pageWindows.set(accountId, win)
  }

  activeAccountId = accountId
  relayout()

  return {
    webContents: win.webContents,
    disposeWindow: async () => {
      if (win && !win.isDestroyed()) win.destroy()
      pageWindows.delete(accountId)
      if (activeAccountId === accountId) {
        activeAccountId = null
        relayout()
      }
    },
  }
}

/** 账号切换：换挂 active pageView（Phase 2.3） */
export function setActiveAccount(accountId: string) {
  if (!pageWindows.has(accountId)) return
  activeAccountId = accountId
  relayout()
}
