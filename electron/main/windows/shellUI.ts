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
// 弹窗语义（Phase 2，fix-shell-popup-navigation-liveend）：view 档默认浏览器语义=new-tab
// （deny-selfdup / new-tab / external / window 档 allow 行为锚）；登录窗口期经 popupIntent
// 显式声明 navigate（同页折叠旧语义），并对官方页 `if(!w) location.href` 兜底做 will-navigate 抑制。
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
import { classifyViewUrl, setTrustResolver } from '#/utils/ipc'
import windowManager from '#/windowManager'
import { attachEntryView, destroyEntryView, getEntryDebug, relayoutEntryView } from './entryView'
import { installExternalProtocolGuard } from './externalProtocolGuard'
import { foldNavigate } from './foldNavigate'
import { shouldWarnLeaveControlPage } from './leaveGuard'
import { getNoticeBusState, pushNotice, resetNoticeBus } from './noticeBus'
import {
  attachNoticeWindow,
  destroyNoticeWindow,
  getNoticeWindowDebug,
  getNoticeWindowWebContents,
} from './noticeWindow'
import { preventPageInitiatedClose } from './pageCloseGuard'
import { clampZoom, nextZoom, ZOOM_DEFAULT, ZOOM_STEP, zoomPercent, zoomStoreKey } from './pageZoom'
import { createPanelController } from './panelController'
import {
  type PendingPopupNav,
  resolvePopupOpenAction,
  shouldSuppressFallbackNavigation,
} from './popupAction'
import { clearPopupMode, getPopupMode, setPopupMode } from './popupIntent'
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
    isFocused: () => wc.isFocused(),
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

/**
 * Cmd/Ctrl + \ 快捷键：显示/隐藏业务面板。
 *
 * 为什么必须有（这不是锦上添花，是可读性硬伤）：
 *   业务面板是 600px 的 **overlay**，浮在官方页面上方；而 pageView 的视口宽是 winW-56。
 *   窗口 1280 时页面按 1224px 布局渲染，右侧 600px（x∈[680,1280]）被面板完全盖住 ——
 *   抖店中控台的评论区/观众列表恰好就在页面右侧，于是**官方页面在渲染、评论也在渲染，但看不见**。
 *
 * 为什么用「收起面板」而不是「压缩页面宽度」：
 *   压缩 pageView 会触发官方页面重排，抖店在窄视口下会自己折叠右侧栏 —— 评论区反而更看不到，
 *   且重排可能打断正在进行的直播操作。overlay 语义（面板展开不改 page bounds）是刻意设计，
 *   正确解法是给用户一个**一键让出右侧**的手段。
 */
function installPanelToggleShortcut(wc: Electron.WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control)) return
    if (input.key !== '\\') return
    event.preventDefault()
    panel.toggle(null)
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
  for (const wc of [chromeView.webContents, railView.webContents]) {
    installZoomShortcuts(wc)
    installPanelToggleShortcut(wc)
  }

  // 业务推送目标 = railView（完整业务树，v3 的 panelView 语义迁移）；顶栏走具名 'chrome' 目标
  windowManager.setUITarget(railView.webContents)
  windowManager.setTarget('chrome', chromeView.webContents)

  // IPC 来源判定：优先 webContents.id 精确比对（防 URL 伪造/视图重建后 id 变化），兜底走 URL。
  // 与 ipc/index.ts 注册的 URL 版相比，这里多了"精确身份"，但**判据不是安全边界本身** ——
  // 边界是 CHANNEL_TRUST 声明表 + 前置校验，本函数只负责回答"你是哪个视图"。
  setTrustResolver(event => {
    const id = event.sender.id
    if (railView && id === railView.webContents.id) return 'rail'
    if (chromeView && id === chromeView.webContents.id) return 'chrome'
    return classifyViewUrl(event.sender.getURL())
  })

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
      // 官方页面聚焦时也要能一键让出右侧（业务面板遮住评论区，见 installPanelToggleShortcut 注释）
      installPanelToggleShortcut(view.webContents)
      // 导航完成恢复该站点记忆缩放（官方中控台默认 100% 会被窗口裁切）
      view.webContents.on('did-finish-load', () => applyStoredZoom(view.webContents))
      view.webContents.on('did-navigate', () => applyStoredZoom(view.webContents))
      // ===== 弹窗语义（fix-shell-popup-navigation-liveend · Phase 2 · A1）=====
      // 默认 = 浏览器语义：官方页 window.open → 壳层**新 Tab**（同 partition），绝不再折叠当前页——
      // fold 会劫持唯一的会话 Page，进而触发「误判下播 → 拆会话/Tab」（本次事故根因）。
      // 例外：会话层在登录/进中控台窗口期显式声明 popupMode='navigate'（见 popupIntent.ts），
      // 此时保留旧「同页折叠」语义（自动化反爬链路依赖），登录完成即复位。
      // 兜底导航抑制（E8 实测）：官方页 `const w = window.open(url); if (!w) location.href = url`
      // 的兜底在 deny 下必然触发——新 Tab 已承载该 URL，必须拦截这次同页跳转，否则仍会劫持会话页。
      // 判定收口到纯函数 popupAction.shouldSuppressFallbackNavigation（可单测），此处只做状态清理与副作用。
      let pendingPopupNav: PendingPopupNav | null = null
      view.webContents.on('will-navigate', (event, targetUrl) => {
        if (!pendingPopupNav) return
        if (Date.now() > pendingPopupNav.expiresAt) {
          pendingPopupNav = null
          return
        }
        if (!shouldSuppressFallbackNavigation(pendingPopupNav, targetUrl, Date.now())) return
        event.preventDefault()
        pendingPopupNav = null
        logger.info(
          'popup-fallback-navigation-suppressed（新 Tab 已承载，拦截当前页兜底跳转）：',
          targetUrl.slice(0, 80),
        )
      })
      view.webContents.setWindowOpenHandler(({ url }) => {
        const decision = classifyPopup({
          currentUrl: view.webContents.getURL(),
          popupUrl: url,
          carrier: 'view',
          // 平台层注入的可信域名：跨域登录/中控页入壳内承载，而非外开系统浏览器
          ownedOrigins: opts.popupOrigins,
        })
        // 门控输入：opener 是否为当前 active（纯决策函数 popupAction.resolvePopupOpenAction 消费）
        const openerActive = tabManager
          ? tabManager.activeWebContentsId() === view.webContents.id
          : false
        const action = resolvePopupOpenAction({
          decision,
          intentMode: getPopupMode(view.webContents.id),
          openerActive,
        })
        if (action.kind === 'deny') {
          logger.info(`popup-rule=${action.reason} 拒绝弹窗，页面留壳内：`, url.slice(0, 80))
          return { action: 'deny' }
        }
        if (action.kind === 'external') {
          logger.info('popup-rule=external 外链走系统浏览器：', url.slice(0, 80))
          if (url.startsWith('http')) void shell.openExternal(url)
          return { action: 'deny' }
        }
        if (action.kind === 'navigate') {
          // 登录/进中控台窗口期：旧语义=同页折叠（自动化链路契约，见 popupIntent.ts）
          logger.info('popup-rule=intent-navigate 登录窗口期折叠当前页：', url.slice(0, 80))
          void foldNavigate({
            loadURL: u => view.webContents.loadURL(u),
            url,
            timeoutMs: FOLD_TIMEOUT_MS,
            log: m => logger.info(m),
          })
          return { action: 'deny' }
        }
        // action.kind === 'new-tab'
        if (!tabManager) {
          logger.warn('popup-rule=new-tab 壳容器未就绪，降级拒绝：', url.slice(0, 80))
          return { action: 'deny' }
        }
        const popupTabId = tabManager.createPopupTab({
          url,
          partition: opts.partition,
          popupOrigins: opts.popupOrigins,
          activate: action.activate,
        })
        pendingPopupNav = { url, expiresAt: Date.now() + 5000 }
        logger.info(
          `popup-rule=new-tab 业务弹窗开壳内新 Tab（tab=${popupTabId} activate=${action.activate} openerActive=${openerActive}）：`,
          url.slice(0, 80),
        )
        if (!action.activate) {
          // 仅后台打开时提示（前台激活时用户直接看到新页面，不再提示减少噪音）
          pushNotice({ variant: 'info', description: '已在新标签页打开该页面' })
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
        // 焦点契约（v2）：不得抛错；已销毁/失败仅 verbose，激活流程不受影响
        focus: () => {
          try {
            if (!view.webContents.isDestroyed()) view.webContents.focus()
          } catch (error) {
            logger.verbose('页面焦点接管失败（不打断激活）：', error)
          }
        },
      }
      return wrapper
    },
    mount: (view, index) => {
      container?.contentView.addChildView((view as RealTabView).real, index)
    },
    unmount: view => {
      const real = (view as RealTabView).real
      const wcId = real.webContents.id
      if (container && !container.isDestroyed()) container.contentView.removeChildView(real)
      real.webContents.close()
      // 意图状态随 Tab 生命周期清理（wcId 可能在 Electron 内被复用，防跨会话泄漏）
      clearPopupMode(wcId)
    },
    pushState: state => {
      windowManager.sendTo('chrome', IPC_CHANNELS.shell.tabsState, state)
    },
    // Tab 生命周期变化 → 布局层重排（几何唯一真源仍是 panelController.computeShellBounds）。
    // E2E 实证：运行时新建 pageView 若不立即重排会停在 0×0——登录页已开在壳内 Tab 却不可见，
    // 直到下一次窗口 resize 才恢复（验收 V4 截图 "Cannot take screenshot with 0 width" 即此）。
    requestLayout: () => panel.resize(),
    // 焦点失败上报（tabManager 兜底 catch）：仅观测，不影响激活
    onFocusError: error => logger.warn('Tab 焦点接管失败（已忽略，不影响激活）：', error),
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
    togglePanel: () => panel.toggle(null),
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
      windowWidth: w,
      windowHeight: h,
      pageBounds: bounds.page,
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
      // v2 焦点契约验证契约（仅 LM_SHELL_DEBUG=1 暴露）：E2E 用它断言「新 Tab 自动获焦」
      focusedWebContentsId: electronWebContents.getFocusedWebContents()?.id ?? null,
      // 局部别名：TS 的窄化在回调闭包里会失效（tabManager 是模块级 let）
      tabs: (() => {
        const tm = tabManager
        if (!tm) return []
        return tm.state().tabs.map(t => ({
          id: t.id,
          wcId: tm.webContentsIdOf(t.id),
          url: t.url,
          active: t.active,
        }))
      })(),
      childrenUrls: container.contentView.children.map(c => {
        const v = c as unknown as WebContentsView
        return v.webContents?.getURL?.() ?? ''
      }),
    }
  }
  const a = app as unknown as Record<string, unknown>
  a.__shellDebug = read
  a.__shellToggle = (routeId?: string | null) => panel.toggle(routeId ?? null)
  // 测试契约（仅 LM_SHELL_DEBUG=1）：模拟会话层声明/复位弹窗意图，供 E2E 覆盖 intent-navigate 折叠路径
  a.__shellPopupMode = (webContentsId: number, mode: 'navigate' | null) =>
    setPopupMode(webContentsId, mode)
  logger.info('LM_SHELL_DEBUG=1：__shellDebug/__shellToggle 已注册')
}
