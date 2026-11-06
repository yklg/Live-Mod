// 单窗口壳形态容器（seamless-fix v3 · A2/B，LM_SHELL_UI=1 启用）
// 承载体定档：pageView = WebContentsView（A0 门禁实证 view+deny 弹窗组合存活：
// 历史三次 view 死亡均发生在 allow 弹窗下；deny 后页面留壳内完成同等导航）。
// 弹窗三段规则（popupPolicy 纯函数 + 结构化日志 popup-rule=<分类>）：
//   deny-selfdup 同 host+path 自复制逃逸 → 纯拒绝；
//   fold         同 host 异 path 业务弹窗 → 折入当前页（foldNavigate 定档失败回退）；
//   external     异 host 外链 → 系统浏览器（对齐主窗口行为）。
// 主窗口 = 壳容器：panelView(WebContentsView, React 应用迁移, ?view=panel) + 每账号一个 pageView(官方页，attach 目标)。
// 关闭容器=退出；关 pageView≠退出（pageView 是 view，不是 window）。
// window 承载体（经典壳窗口模式）弹窗策略不同属平台约束驱动，见 shellWindowManager A3 注释互引。
import { type BrowserWindow, shell, WebContentsView } from 'electron'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import { foldNavigate } from './foldNavigate'
import { classifyPopup } from './popupPolicy'
import { chromeUa } from './ua'

const logger = createLogger('ShellUI')

// 面板 CSS 宽度必须 ≥768：桌面侧栏容器是 `hidden md:block`（Tailwind CSS 媒体查询，
// 与 BREAKPOINTS.MOBILE=768 同源），JS 豁免管不到 CSS 断点——640 面板实测侧栏整体 display:none。
// 800 = 768 断点 + 余量；pageView 保底 640（A0 门禁实证可用宽度）。
const PANEL_WIDTH = 800
const PANEL_MIN = 768
const PAGE_VIEW_MIN = 640
// fold loadURL 超时定档（Q6）：超时回退纯 deny，禁止半导航悬挂
const FOLD_TIMEOUT_MS = 8000

let container: BrowserWindow | null = null
let panelView: WebContentsView | null = null
let activeAccountId: string | null = null
let enabled = false

const pageViews = new Map<string, WebContentsView>()

export function isShellUIEnabled() {
  return enabled
}

/**
 * 绑定主窗口为壳容器：panelView 加载 React 应用（迁移，非并存——主窗口自身 webContents 不承载 UI）。
 * panelView 与主窗口共用 preload（window.ipcRenderer 契约不变）。
 * URL 追加 ?view=panel：面板内 useIsMobile 豁免，640px 以桌面布局渲染侧栏。
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

  if (entry.url) {
    panelView.webContents.loadURL(`${entry.url}${entry.url.includes('?') ? '&' : '?'}view=panel`)
  } else if (entry.file) {
    panelView.webContents.loadFile(entry.file, { query: { view: 'panel' } })
  }

  // windowManager 的 main→renderer 推送目标切到 panelView（React 应用现在住在 panelView）
  windowManager.setUITarget(panelView.webContents)

  // 壳模式默认内容区 1440×800 = 面板 800 + 官方页 640（A0 门禁实证可用宽度）；不足则启动时放大一次
  const [cw, ch] = win.getContentSize()
  if (cw < PANEL_WIDTH + PAGE_VIEW_MIN)
    win.setContentSize(PANEL_WIDTH + PAGE_VIEW_MIN, Math.max(ch, 800))

  win.on('resize', relayout)
  win.on('move', relayout)
  win.on('enter-full-screen', relayout)
  win.on('leave-full-screen', relayout)
  relayout()

  win.once('closed', () => {
    container = null
    panelView = null
    activeAccountId = null
    pageViews.clear()
    enabled = false
    windowManager.clearUITarget()
  })

  logger.success('壳容器已绑定，panelView 已加载应用（panel 模式）')
}

function relayout() {
  if (!container || container.isDestroyed()) return
  const [w, h] = container.getContentSize()
  const active = activeAccountId ? pageViews.get(activeAccountId) : null

  // 注：WebContentsView 本身无 isDestroyed()，以 webContents 状态为准
  if (active && !active.webContents.isDestroyed()) {
    // 面板恒 ≥768（CSS 断点硬下限），pageView 尽量保 640；窗口过窄时优先保面板
    const pw = Math.max(PANEL_MIN, Math.min(PANEL_WIDTH, w - PAGE_VIEW_MIN))
    active.setBounds({ x: 0, y: 0, width: w - pw, height: h })
    panelView?.setBounds({ x: w - pw, y: 0, width: pw, height: h })
  } else {
    panelView?.setBounds({ x: 0, y: 0, width: w, height: h })
  }
}

/** 供 ShellWindowManager 在壳容器模式调用：创建/复用该账号的 pageView（attach 目标） */
export function openPageView(accountId: string): {
  webContents: WebContentsView['webContents']
  disposeWindow: () => Promise<void>
} {
  if (!container || container.isDestroyed()) throw new Error('壳容器未就绪')

  let view = pageViews.get(accountId)
  if (!view || view.webContents.isDestroyed()) {
    view = new WebContentsView({
      webPreferences: {
        // 独立 partition 持久化登录态；无 preload、nodeIntegration:false + contextIsolation:true
        // ——禁止把 IPC 面暴露给官方远程页
        partition: `persist:lm-shell-${accountId}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    const v = view
    v.webContents.setUserAgent(chromeUa())
    v.webContents.setWindowOpenHandler(({ url }) => {
      const decision = classifyPopup({
        currentUrl: v.webContents.getURL(),
        popupUrl: url,
        carrier: 'view',
      })
      switch (decision) {
        case 'deny-selfdup':
          logger.info(
            'popup-rule=deny-selfdup 拒绝自复制弹窗（反嵌入逃逸），页面留壳内：',
            url.slice(0, 80),
          )
          break
        case 'fold':
          logger.info('popup-rule=fold 业务弹窗折入当前页：', url.slice(0, 80))
          void foldNavigate({
            loadURL: u => v.webContents.loadURL(u),
            url,
            timeoutMs: FOLD_TIMEOUT_MS,
            log: m => logger.info(m),
          })
          break
        case 'external':
          logger.info('popup-rule=external 外链走系统浏览器：', url.slice(0, 80))
          if (url.startsWith('http')) void shell.openExternal(url)
          break
        default:
          // view 档 classifyPopup 不产出 allow；防御性拒绝（allow 会销毁 view）
          logger.warn(
            'popup-rule=view 档收到 allow 分类（不应发生），按 deny 处理：',
            url.slice(0, 80),
          )
      }
      return { action: 'deny' }
    })
    // 一道防线足够：did-request-close 拒绝页面发起的 view 销毁（A0 实证 allow 弹窗才是死因，非 close）
    v.webContents.on('did-request-close', e => {
      logger.warn('已拒绝页面发起的 pageView 关闭（保会话载体存活）')
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
