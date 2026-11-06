// 光圈式单窗口壳容器（guangquan-shell-ui-parity v3，替换 seamless-fix v3 分栏形态）
// 拓扑：主窗口 = 纯容器；chromeView（顶栏，chrome.html）+ railView（右栏图标+面板，rail.html）
//       + entryView（入口平台选择器，entry.html，shell-entry-platform-selector v1）
//       + 每 Tab 一个 pageView（官方页/任意页，attach 目标）。
// 层级铁律（P0-2，v1 更新）：contentView 子序 [page(底, index 0), entry(1), chrome(2), rail(3)]；
//       pageView 挂载统一走 tabManager.deps.mount（恒 index 0），entry/chrome/rail 在 attachContainer 一次挂定。
// 入口视图铁律：入口是本地受信入口视图（带 preload，仅 shell:* 通道），**不是 pageView**；
//       页面区被入口覆盖时官方页仍在底层，入口隐藏即恢复（不重新加载）。
// 监听树划分（P0-1/A1）：chrome 入口=最小树（仅 shell:* 通道），rail 入口=完整业务树
//       （windowManager 'ui' 目标 = railView；业务推送零改动经 send→'ui' 别名路由）。
// 几何唯一真源：shellLayout.computeShellBounds（A3）；面板开合唯一真源：panelController（A2）。
// 弹窗三段（deny-selfdup/fold/external）与防自杀行为锚自 v3 平移不变（popupPolicy view 档）。
// 平台边界（A5）：本层平台无关——中控页 URL/登录态/attach 由会话层决定，禁止此处出现平台 if。

import { randomUUID } from 'node:crypto'
import {
  app,
  type BrowserWindow,
  webContents as electronWebContents,
  shell,
  WebContentsView,
} from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { loadZoomFactor, saveZoomFactor } from '#/services/ZoomStore'
import windowManager from '#/windowManager'
import { attachEntryView, destroyEntryView, getEntryDebug, relayoutEntryView } from './entryView'
import { installExternalProtocolGuard } from './externalProtocolGuard'
import { foldNavigate } from './foldNavigate'
import { shouldWarnLeaveControlPage } from './leaveGuard'
import { getNoticeBusState, resetNoticeBus } from './noticeBus'
import {
  attachNoticeWindow,
  destroyNoticeWindow,
  getNoticeWindowDebug,
  getNoticeWindowWebContents,
} from './noticeWindow'
import { preventPageInitiatedClose } from './pageCloseGuard'
import { clampZoom, nextZoom, ZOOM_DEFAULT, ZOOM_STEP, zoomPercent, zoomStoreKey } from './pageZoom'
import { createPanelController } from './panelController'
import { classifyPopup } from './popupPolicy'
import { computeEntryBounds, computeShellBounds } from './shellLayout'
import { installShellMenu } from './shellMenu'
import { createShellTabManager, type TabView } from './shellTabManager'
import { chromeUa } from './ua'
import { loadAppEntry, makeAppView } from './viewHost'

const logger = createLogger('ShellUI')

// fold loadURL 超时定档（v3 Q6）：超时回退纯 deny，禁止半导航悬挂
const FOLD_TIMEOUT_MS = 8000

let container: BrowserWindow | null = null
let chromeView: WebContentsView | null = null
let railView: WebContentsView | null = null

let enabled = false

interface RealTabView extends TabView {
  real: WebContentsView
}

let tabManager: ReturnType<typeof createShellTabManager> | null = null
let panel = createPanelController({
  winSize: () => ({ w: 0, h: 0 }),
  hasActiveTab: () => false,
  applyBounds: () => {},
  pushRail: () => {},
})

export function isShellUIEnabled() {
  return enabled
}

export function getContainer(): BrowserWindow | null {
  return container && !container.isDestroyed() ? container : null
}

// canGoBack/canGoForward 走 navigationHistory（E36 起 webContents.canGoBack 弃用告警）
function makeTabWebContentsFacade(wc: WebContentsView['webContents']): TabView['webContents'] {
  const nav = (
    wc as unknown as { navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean } }
  ).navigationHistory
  return {
    id: wc.id,
    getURL: () => wc.getURL(),
    getTitle: () => wc.getTitle(),
    isLoading: () => wc.isLoading(),
    isDestroyed: () => wc.isDestroyed(),
    canGoBack: () => nav?.canGoBack() ?? false,
    canGoForward: () => nav?.canGoForward() ?? false,
    loadURL: u => wc.loadURL(u),
    goBack: () => wc.goBack(),
    goForward: () => wc.goForward(),
    reload: () => wc.reload(),
    close: () => wc.close(),
    on: (ev, fn) => wc.on(ev as Parameters<typeof wc.on>[0], fn as never),
    off: (ev, fn) => wc.off(ev as Parameters<typeof wc.off>[0], fn as never),
  }
}

// ==================== 壳内页面缩放（page zoom，验证期用户反馈） ====================
// 快捷键路径：壳模式自定义菜单（shellMenu）+ before-input-event 双保险；
// 记忆：按站点 host 持久化（userData/shell-zoom.json），导航完成时自动恢复。

function activeTabContents(): Electron.WebContents | null {
  if (!tabManager) return null
  const state = tabManager.state()
  const wcId = tabManager.webContentsIdOf(state.activeId)
  return electronWebContents.fromId(wcId) ?? null
}

function currentZoomFactor(): number {
  return activeTabContents()?.getZoomFactor() ?? ZOOM_DEFAULT
}

function persistZoom(wc: Electron.WebContents, factor: number) {
  const key = zoomStoreKey(wc.getURL())
  if (key) saveZoomFactor(key, factor)
}

function applyZoomStep(delta: number) {
  const wc = activeTabContents()
  if (!wc) return
  const factor = nextZoom(wc.getZoomFactor(), delta)
  wc.setZoomFactor(factor)
  persistZoom(wc, factor)
}

function applyZoomReset() {
  const wc = activeTabContents()
  if (!wc) return
  wc.setZoomFactor(ZOOM_DEFAULT)
  persistZoom(wc, ZOOM_DEFAULT)
}

/** 导航完成后按 host 恢复记忆缩放（官方中控台按站点记住用户偏好） */
function applyStoredZoom(wc: Electron.WebContents) {
  const key = zoomStoreKey(wc.getURL())
  if (!key) return
  const factor = clampZoom(loadZoomFactor(key))
  if (Math.abs(factor - wc.getZoomFactor()) > 0.001) wc.setZoomFactor(factor)
}

/** Cmd/Ctrl + =/-/0 快捷键（菜单加速器被系统菜单消费时此路不触发；未被消费时兜底） */
function installZoomShortcuts(wc: Electron.WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control)) return
    if (input.key === '=' || input.key === '+') {
      event.preventDefault()
      applyZoomStep(ZOOM_STEP)
    } else if (input.key === '-') {
      event.preventDefault()
      applyZoomStep(-ZOOM_STEP)
    } else if (input.key === '0') {
      event.preventDefault()
      applyZoomReset()
    }
  })
}

export function attachContainer(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  enabled = true
  container = win

  chromeView = makeAppView(preloadPath, 'chrome')
  railView = makeAppView(preloadPath, 'rail')
  // 层级铁律（P0-2 v1）：按 append 顺序建 [entry, chrome, rail]，再让 pageView mount 到 index 0 →
  // 最终子序 [page(0), entry(1), chrome(2), rail(3)]（依赖 tabManager mount 恒 index 0 的插入语义）。
  attachEntryView(win, entry, preloadPath)
  win.contentView.addChildView(chromeView)
  win.contentView.addChildView(railView)
  // 壳级通知覆盖层：独立透明子窗口（真点击穿透 + 父子窗口最顶层；视图方案无 setIgnoreMouseEvents——探针结论）
  attachNoticeWindow(win, entry, preloadPath)
  const noticeWc = getNoticeWindowWebContents()
  if (noticeWc) windowManager.setTarget('notice', noticeWc)
  // 壳内任意视图聚焦时 Cmd/Ctrl +/-/0 都作用于当前活跃 Tab（地址栏/入口同样可用）
  for (const wc of [chromeView.webContents, railView.webContents]) installZoomShortcuts(wc)

  // 业务推送目标 = railView（完整业务树，v3 的 panelView 语义迁移）；顶栏走具名 'chrome' 目标
  windowManager.setUITarget(railView.webContents)
  windowManager.setTarget('chrome', chromeView.webContents)

  tabManager = createShellTabManager({
    newView: opts => {
      const view = new WebContentsView({
        webPreferences: {
          // 独立 partition 持久化登录态；无 preload、nodeIntegration:false + contextIsolation:true
          // ——禁止把 IPC 面暴露给官方远程页
          partition: opts.partition,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      view.webContents.setUserAgent(chromeUa())
      // 官方页 JS 触发的 bytedance:// 等深链导航必须拦截（否则 macOS 系统弹窗打断壳内流程）
      installExternalProtocolGuard(view.webContents, msg => logger.warn(msg))
      installZoomShortcuts(view.webContents)
      // 导航完成恢复该站点记忆缩放（官方中控台默认 100% 会被窗口裁切）
      view.webContents.on('did-finish-load', () => applyStoredZoom(view.webContents))
      view.webContents.on('did-navigate', () => applyStoredZoom(view.webContents))
      view.webContents.setWindowOpenHandler(({ url }) => {
        const decision = classifyPopup({
          currentUrl: view.webContents.getURL(),
          popupUrl: url,
          carrier: 'view',
          // 平台层注入的可信域名：跨域登录/中控页 fold 入壳内，而非外开系统浏览器
          ownedOrigins: opts.popupOrigins,
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
              loadURL: u => view.webContents.loadURL(u),
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
            logger.warn(
              'popup-rule=view 档收到 allow 分类（不应发生），按 deny 处理：',
              url.slice(0, 80),
            )
        }
        return { action: 'deny' }
      })
      // 一道防线足够：did-request-close 拒绝页面发起的 view 销毁（A0 实证 allow 弹窗才是死因，非 close）
      preventPageInitiatedClose(view.webContents, m => logger.warn(m))
      const wrapper: RealTabView = {
        real: view,
        webContents: makeTabWebContentsFacade(view.webContents),
        setVisible: v => view.setVisible(v),
        setBounds: b => view.setBounds(b),
      }
      return wrapper
    },
    mount: (view, index) => {
      container?.contentView.addChildView((view as RealTabView).real, index)
    },
    unmount: view => {
      const real = (view as RealTabView).real
      if (container && !container.isDestroyed()) container.contentView.removeChildView(real)
      real.webContents.close()
    },
    pushState: state => {
      windowManager.sendTo('chrome', IPC_CHANNELS.shell.tabsState, state)
    },
    // Tab 生命周期变化 → 布局层重排（几何唯一真源仍是 panelController.computeShellBounds）。
    // E2E 实证：运行时新建 pageView 若不立即重排会停在 0×0——登录页已开在壳内 Tab 却不可见，
    // 直到下一次窗口 resize 才恢复（验收 V4 截图 "Cannot take screenshot with 0 width" 即此）。
    requestLayout: () => panel.resize(),
  })

  panel = createPanelController({
    winSize: () => {
      if (!container || container.isDestroyed()) return { w: 0, h: 0 }
      const [w, h] = container.getContentSize()
      return { w, h }
    },
    hasActiveTab: () => tabManager?.hasActiveTab() ?? false,
    applyBounds: b => {
      if (chromeView) chromeView.setBounds(b.chrome)
      if (railView) railView.setBounds(b.rail)
      tabManager?.applyPageBounds(b.page)
      if (container && !container.isDestroyed()) {
        const [w, h] = container.getContentSize()
        relayoutEntryView(computeEntryBounds({ winW: w, winH: h }))
      }
    },
    pushRail: s => {
      windowManager.sendTo('ui', IPC_CHANNELS.shell.railState, s)
    },
  })

  const relayout = () => panel.resize()
  win.on('resize', relayout)
  win.on('move', relayout)
  win.on('enter-full-screen', relayout)
  win.on('leave-full-screen', relayout)

  // 不变量：启动即有 ≥1 Tab（空白页）；地址栏/新 Tab 由 chromeView 请求驱动
  tabManager.createTab({})
  relayout()

  // 入口加载放在 tabManager 就绪之后：chrome 首帧 invoke(tabsList) 不再撞「壳容器未就绪」
  loadAppEntry(chromeView, entry, 'chrome')
  loadAppEntry(railView, entry, 'rail')

  // 壳模式自定义菜单：缩放快捷键作用于壳内活跃 Tab（默认菜单 Zoom 角色对 WebContentsView 无效）
  installShellMenu({
    zoomIn: () => applyZoomStep(ZOOM_STEP),
    zoomOut: () => applyZoomStep(-ZOOM_STEP),
    zoomReset: applyZoomReset,
  })

  if (process.env.LM_SHELL_DEBUG === '1') registerShellDebug()

  win.once('closed', () => {
    destroyEntryView()
    destroyNoticeWindow()
    resetNoticeBus()
    container = null
    chromeView = null
    railView = null
    tabManager = null
    enabled = false
    windowManager.clearUITarget()
  })

  logger.success('壳容器已绑定（光圈式：chrome/rail/entry 三入口 + Tab 归属）')
}

// ==================== 对外 facade（ipc/shell.ts、shellWindowManager、ipc/app.ts 消费） ====================

function requireTabs() {
  if (!tabManager) throw new Error('壳容器未就绪')
  return tabManager
}

export function shellTabCreate(params: { url?: string; accountId?: string }): number {
  return requireTabs().createTab(params)
}

export function shellTabClose(id: number) {
  requireTabs().closeTab(id)
}

export function shellTabActivate(id: number) {
  requireTabs().activateTab(id)
}

export function shellTabsList() {
  return requireTabs().state()
}

export function shellTabWebContentsId(id: number) {
  return requireTabs().webContentsIdOf(id)
}

/** 地址栏导航：先过离开护栏（P2-6，不阻断），再委托 tabManager */
export async function shellTabNavigate(id: number, url: string) {
  const tabs = requireTabs()
  const info = tabs.tabInfoOf(id)
  if (info?.kind === 'account' && info.accountId) {
    // 动态 import：壳层不得静态依赖会话管理层（循环边规避，ipc/app.ts 同款模式；A5 边界）
    const { accountManager } = await import('#/managers/AccountManager')
    const taskRunning =
      accountManager.accountSessions.get(info.accountId)?.hasActiveTasks() ?? false
    if (taskRunning) {
      const controlHost = safeHost(tabWebContents(tabs.webContentsIdOf(id))?.getURL() ?? '')
      if (
        controlHost &&
        shouldWarnLeaveControlPage({ kind: 'account', taskRunning, toUrl: url, controlHost })
      ) {
        windowManager.sendTo('ui', IPC_CHANNELS.shell.warnToast, '任务依赖中控页，已离开可能失效')
      }
    }
  }
  await tabs.navigate(id, url)
}

export function shellTabBack(id: number) {
  requireTabs().goBack(id)
}
export function shellTabForward(id: number) {
  requireTabs().goForward(id)
}
export function shellTabReload(id: number) {
  requireTabs().reload(id)
}

/** 面板开合唯一入口（A2）：chrome「展开」与 rail 图标/ESC 同走此处 */
export function shellRailToggle(routeId?: string | null) {
  panel.toggle(routeId ?? null)
}

function tabWebContents(wcId: number): Electron.WebContents | undefined {
  return electronWebContents.fromId(wcId) ?? undefined
}

function safeHost(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : ''
  } catch {
    return ''
  }
}

/** 账号切换（ipc/app.ts 调用点不变）：换挂该账号 Tab */
export function setActiveAccount(accountId: string) {
  if (!tabManager) return
  const id = tabManager.tabIdForAccount(accountId)
  if (id != null) tabManager.activateTab(id)
}

/** shellWindowManager.open() 委托入口：账号 Tab（复用锚）+ nonce 寻址页 */
export function ensureAccountTab(
  accountId: string,
  opts?: { popupOrigins?: readonly string[] },
): {
  nonce: string
  windowId: number
  disposeWindow: () => Promise<void>
} {
  const tabs = requireTabs()
  const nonce = `lm-nonce-${accountId}-${randomUUID()}`
  const tabId = tabs.createTab({ accountId, popupOrigins: opts?.popupOrigins })
  const wc = tabWebContents(tabs.webContentsIdOf(tabId))
  if (!wc) throw new Error('账号 Tab webContents 不可达')
  wc.loadURL(`about:blank#${nonce}`).catch(err => logger.error('nonce 页加载失败：', err))
  logger.success('壳 pageView Tab 已就绪（账号：', accountId, '）')
  return { nonce, windowId: wc.id, disposeWindow: async () => tabs.closeTab(tabId) }
}

// ==================== E2E 调试契约（LM_SHELL_DEBUG=1，poc/shell/e2e-shell-parity.mjs 消费） ====================

function registerShellDebug() {
  const read = () => {
    if (!container || !tabManager || !chromeView || !railView) {
      throw new Error('shell not ready')
    }
    const [w, h] = container.getContentSize()
    const bounds = computeShellBounds({
      winW: w,
      winH: h,
      panelOpen: panel.isOpen(),
      activeTabPresent: tabManager.hasActiveTab(),
    })
    const entry = getEntryDebug()
    const noticeBus = getNoticeBusState()
    const notice = getNoticeWindowDebug()
    return {
      panelOpen: panel.isOpen(),
      routeId: panel.route(),
      railWidth: bounds.rail.width,
      zoomPercent: zoomPercent(currentZoomFactor()),
      entryVisible: entry.visible,
      entryUrl: entry.url,
      entryBounds: entry.bounds,
      expectedEntryBounds: computeEntryBounds({ winW: w, winH: h }),
      noticeUrl: notice.url,
      noticeVisible: notice.visible,
      noticeBounds: notice.bounds,
      expectedNoticeBounds: notice.expectedBounds,
      noticeBus: {
        ready: noticeBus.ready,
        pending: noticeBus.pending.length,
        dropped: noticeBus.dropped,
      },
      childrenUrls: container.contentView.children.map(c => {
        const v = c as unknown as WebContentsView
        return v.webContents?.getURL?.() ?? ''
      }),
    }
  }
  const a = app as unknown as Record<string, unknown>
  a.__shellDebug = read
  a.__shellToggle = (routeId?: string | null) => panel.toggle(routeId ?? null)
  logger.info('LM_SHELL_DEBUG=1：__shellDebug/__shellToggle 已注册')
}
