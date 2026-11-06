// 单窗口壳形态容器（Phase 2，LM_SHELL_UI=1 启用；browser-shell-formalization-plan v3 §Phase 2）
// 主窗口 = 纯容器：panelView(React 应用整体迁移) + 每账号一个 pageView(官方中控台页，attach 目标)。
// 关闭容器=退出；关 pageView≠退出（pageView 是 view，不是 window）。
import { type BrowserWindow, shell, WebContentsView } from 'electron'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import { chromeUa } from './ua'

const logger = createLogger('ShellUI')

const PANEL_WIDTH = 460
let container: BrowserWindow | null = null
let panelView: WebContentsView | null = null
let activeAccountId: string | null = null
let enabled = false

const pageViews = new Map<string, WebContentsView>()

export function isShellUIEnabled() {
  return enabled
}

/**
 * 绑定主窗口为壳容器：panelView 加载 React 应用（迁移，非并存——主窗口自身 webContents 不再承载 UI）。
 * panelView 与主窗口共用 preload（window.ipcRenderer 契约不变，路由/状态/IPC 监听全保留）。
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

  // 外部链接走系统浏览器（对齐经典模式 setWindowOpenHandler）
  panelView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (entry.url) panelView.webContents.loadURL(entry.url)
  else if (entry.file) panelView.webContents.loadFile(entry.file)

  // 关键：windowManager 的 send 目标从主窗口切到 panelView（React 应用现在住在 panelView）
  windowManager.setUITarget(panelView.webContents)

  win.on('resize', relayout)
  relayout()

  win.once('closed', () => {
    container = null
    panelView = null
    activeAccountId = null
    pageViews.clear()
    enabled = false
    windowManager.clearUITarget()
  })

  logger.success('壳容器已绑定，panelView 已加载应用')
}

function relayout() {
  if (!container || container.isDestroyed()) return
  const [w, h] = container.getContentSize()
  const active = activeAccountId ? pageViews.get(activeAccountId) : null

  // 注：WebContentsView 本身无 isDestroyed()，以 webContents 状态为准
  if (active && !active.webContents.isDestroyed()) {
    const pw = Math.min(PANEL_WIDTH, Math.floor(w * 0.5))
    active.setBounds({ x: 0, y: 0, width: w - pw, height: h })
    panelView?.setBounds({ x: w - pw, y: 0, width: pw, height: h })
  } else {
    panelView?.setBounds({ x: 0, y: 0, width: w, height: h })
  }
}

/** 供 ShellWindowManager 在 view 模式调用：创建/复用该账号的 pageView（attach 目标） */
export function openPageView(accountId: string): {
  webContents: WebContentsView['webContents']
  disposeWindow: () => Promise<void>
} {
  if (!container || container.isDestroyed()) throw new Error('壳容器未就绪')

  let view = pageViews.get(accountId)
  if (!view || view.webContents.isDestroyed()) {
    view = new WebContentsView({
      webPreferences: {
        partition: `persist:lm-shell-${accountId}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.webContents.setUserAgent(chromeUa())
    // 弹窗流→子窗口 + 防自杀守卫（与窗口模式同语义，见 shellWindowManager 注释）
    const v = view
    v.webContents.setWindowOpenHandler(({ url }) => {
      logger.info('pageView 弹窗流→子窗口：', url)
      return { action: 'allow' }
    })
    v.webContents.on('did-create-window', child => {
      child.webContents.setUserAgent(chromeUa())
    })
    v.webContents.on('did-request-close', e => {
      logger.warn('已拒绝页面发起的 pageView 关闭')
      e.preventDefault()
    })
    container.contentView.addChildView(v)
    pageViews.set(accountId, v)
  }

  activeAccountId = accountId
  relayout()

  return {
    webContents: view.webContents,
    disposeWindow: async () => {
      const target = pageViews.get(accountId)
      if (target && container && !container.isDestroyed()) {
        container.contentView.removeChildView(target)
        target.webContents.close()
      }
      pageViews.delete(accountId)
      if (activeAccountId === accountId) {
        activeAccountId = null
        relayout()
      }
    },
  }
}

/** 账号切换：换挂 active pageView（Phase 2.3） */
export function setActiveAccount(accountId: string) {
  if (!pageViews.has(accountId)) return
  activeAccountId = accountId
  relayout()
}
