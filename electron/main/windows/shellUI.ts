// 光圈式单窗口壳容器（guangquan-shell-ui-parity v3，替换 seamless-fix v3 分栏形态）
// 拓扑：主窗口 = 纯容器；chromeView（顶栏，chrome.html）+ railView（右栏图标+面板，rail.html）
//       + entryView（平台选择器，entry.html）+ 每 Tab 一个 pageView（官方页/任意页，attach 目标）。
// 层级：contentView 子序 [page(底, index 0), entry(1), chrome(2), rail(3)]；
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
import { isKnownShellRouteId } from 'shared/shellRoutes'
import type { ShellChromeState, ShellMode } from 'shared/shellState'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { defaultZoomForHost } from '#/platforms/zoomPolicy'
import { LAYOUT_STORE_VERSION, loadLayoutState, saveLayoutState } from '#/services/LayoutStore'
import { loadZoomFactor, saveZoomFactor } from '#/services/ZoomStore'
import { classifyViewUrl, setTrustResolver } from '#/utils/ipc'
import windowManager from '#/windowManager'
import {
  attachAssistantWindow,
  destroyAssistantWindow,
  getAssistantWindowWebContents,
  hideAssistantWindow,
  isAssistantWindowVisible,
  toggleAssistantWindow,
} from './assistantWindow'
import { setChromeHeight } from './chromeMetrics'
import { configureEntryStartup, startEntryFallback, stopEntryStartup } from './entryStartup'
import {
  attachEntryView,
  destroyEntryView,
  getEntryDebug,
  getEntryWebContents,
  hideEntry,
  relayoutEntryView,
  showEntry,
} from './entryView'
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
import { clampZoom, nextZoom, ZOOM_DEFAULT, ZOOM_STEP, zoomPercent, zoomStoreKey } from './pageZoom'
import { createPanelController } from './panelController'
import {
  attachPanelDragWindow,
  destroyPanelDragWindow,
  hidePanelDragWindow,
  isPanelDragWindowVisible,
  showPanelDragWindow,
} from './panelDragWindow'
import {
  type PendingPopupNav,
  resolvePopupOpenAction,
  shouldSuppressFallbackNavigation,
} from './popupAction'
import { clearPopupMode, getPopupMode, setPopupMode } from './popupIntent'
import { classifyPopup } from './popupPolicy'
import { clampDockWidth, computeShellBounds, DOCK_W, draggedPanelWidth } from './shellLayout'
import { installShellMenu } from './shellMenu'
import { createShellMode, shellModeForTabKind } from './shellMode'
import { createShellTabManager, type TabView } from './shellTabManager'
import { planSurface, type SurfaceOptions } from './surfaceController'
import { chromeUa } from './ua'
import { loadAppEntry, makeAppView } from './viewHost'

const logger = createLogger('ShellUI')

// 当前 dock 宽度（LayoutStore 恢复 / 拖拽导体写入；几何计算只读这个值）。
let panelWidth = DOCK_W
// 一次拖拽的起点：导体只回传 screenX，宽度算术在主进程保持单一真源。
let panelDragStart: { width: number; screenX: number } | null = null
const shellMode = createShellMode('entry')
// assistant 懒创建所需入口参数（首次 Cmd+J/顶栏点击才创建，避免启动期多一个窗口抢焦点/E2E firstWindow）。
let assistantEntry: { url?: string; file?: string } | null = null
let assistantPreloadPath: string | null = null

// fold loadURL 超时定档（v3 Q6）：超时回退纯 deny，禁止半导航悬挂
const FOLD_TIMEOUT_MS = 8000

let container: BrowserWindow | null = null
let chromeView: WebContentsView | null = null
let railView: WebContentsView | null = null

interface RealTabView extends TabView {
  real: WebContentsView
}

let tabManager: ReturnType<typeof createShellTabManager> | null = null
let panel = createPanelController({
  winSize: () => ({ w: 0, h: 0 }),
  hasActiveTab: () => false,
  mode: () => shellMode.mode(),
  dockWidth: () => panelWidth,
  applyBounds: () => {},
  pushRail: () => {},
})

/**
 * 壳 UI 是否启用：经典模式已移除 ⇒ 恒为 true。
 * 保留函数口径是因为调用方（连接模式裁决/壳 IPC/入口视图）仍以「形态能力」而非硬编码表达，
 * 未来若有第二形态（如无头/MAS）可在此单点扩展。
 */
export function isShellUIEnabled() {
  return true
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
  if (key) saveZoomFactor(key, factor, undefined, defaultZoomForHost(key))
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
  const key = zoomStoreKey(wc.getURL())
  // 重置回该站点的默认值（中控台 80%），而不是全局 1——否则用户按 Cmd+0 会再次被裁切。
  const factor = key ? defaultZoomForHost(key) : ZOOM_DEFAULT
  wc.setZoomFactor(factor)
  if (key) saveZoomFactor(key, factor, undefined, factor)
}

/** 导航完成后按 host 恢复缩放：用户记忆优先，其次平台默认值（中控台 80%）。 */
function applyStoredZoom(wc: Electron.WebContents) {
  const key = zoomStoreKey(wc.getURL())
  if (!key) return
  const fallback = defaultZoomForHost(key)
  const factor = clampZoom(loadZoomFactor(key, undefined, fallback))
  if (Math.abs(factor - wc.getZoomFactor()) > 0.001) wc.setZoomFactor(factor)
}

/** Cmd/Ctrl + =/-/0 快捷键（菜单加速器被系统菜单消费时此路不触发；未被消费时兜底） */
function installZoomShortcuts(wc: Electron.WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    // ESC 关顶栏悬浮菜单（壳 v3 · Wave 3 · P1-4 双保险）：
    // 焦点可能在 page（官方远程页，无 preload，拿不到渲染层 keydown）/ chrome / rail 任一处，
    // 这里在主进程侧兜住"焦点不在 rail"的情况。
    if (input.key === 'Escape' && panel.isMenuOpen()) {
      event.preventDefault()
      panel.closeMenu()
      return
    }
    if (!(input.meta || input.control)) return
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
    shellRailToggle(null)
  })
}

/** 标签键盘契约：Cmd/Ctrl+T/W/1-9、Cmd/Ctrl+Shift+T；标签只在 browse 可操作。 */
function installTabShortcuts(wc: Electron.WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control) || !tabManager) return
    const key = input.key.toLowerCase()
    const mode = shellMode.mode()
    if (key === 't') {
      event.preventDefault()
      if (input.shift) {
        if (mode !== 'entry') tabManager.reopenLast()
        return
      }
      // 标签轴合并后：非 entry 直接新建自由 Tab（不再先切 browse 模式）。
      if (mode === 'entry') return
      tabManager.createTab({})
      return
    }
    if (key === 'w') {
      event.preventDefault()
      if (mode === 'entry') return
      const state = tabManager.state()
      const active = state.tabs.find(t => t.id === state.activeId)
      // 账号 Tab 是固定卡：Cmd+W 对它 no-op（关闭账号由账号移除流程负责）。
      if (active && active.kind !== 'account') tabManager.closeTab(active.id)
      return
    }
    if (/^[1-9]$/.test(input.key)) {
      event.preventDefault()
      if (mode === 'entry') return
      // 编号包含固定的账号 Tab（浏览器语义：标签序即可见顺序）。
      const tabs = tabManager.state().tabs
      const index = Number(input.key) === 9 ? tabs.length - 1 : Number(input.key) - 1
      const target = tabs[index]
      if (target) tabManager.activateTab(target.id)
    }
  })
}

/** AI 浮窗全局入口：Cmd/Ctrl+J；顶栏按钮走同一 facade。 */
function installAssistantShortcut(wc: Electron.WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control)) return
    if (input.key.toLowerCase() !== 'j' || input.shift) return
    event.preventDefault()
    shellAssistantToggle()
  })
}

export function attachContainer(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  container = win

  chromeView = makeAppView(preloadPath, 'chrome')
  railView = makeAppView(preloadPath, 'rail')
  // 层级：entry 先挂（index 0），page mount 时插到 0 → [page, entry, chrome, rail]。
  attachEntryView(win, entry, preloadPath)
  win.contentView.addChildView(chromeView)
  win.contentView.addChildView(railView)
  configureEntryStartup({
    applySurface: applyShellSurface,
    getMode: () => shellMode.mode(),
  })
  startEntryFallback()
  // 壳级通知覆盖层：独立透明子窗口（真点击穿透 + 父子窗口最顶层；视图方案无 setIgnoreMouseEvents——探针结论）
  attachNoticeWindow(win, entry, preloadPath)
  // 面板拖拽导体：透明全窗子窗口，预创建隐藏，仅在拖拽期间显示。
  attachPanelDragWindow(win, entry, preloadPath)
  // AI 助手全局浮窗：懒创建（首次 Cmd+J/顶栏点击），避免启动期多窗口抢 firstWindow。
  assistantEntry = entry
  assistantPreloadPath = preloadPath
  const noticeWc = getNoticeWindowWebContents()
  if (noticeWc) windowManager.setTarget('notice', noticeWc)
  // 壳内任意视图聚焦时 Cmd/Ctrl +/-/0 都作用于当前活跃 Tab（地址栏/入口同样可用）
  const entryWc = getEntryWebContents()
  const shellWcs = entryWc
    ? [chromeView.webContents, railView.webContents, entryWc]
    : [chromeView.webContents, railView.webContents]
  for (const wc of shellWcs) {
    installZoomShortcuts(wc)
    installPanelToggleShortcut(wc)
    installTabShortcuts(wc)
    installAssistantShortcut(wc)
  }

  // 业务推送目标 = railView（完整业务树）；chrome 接收模式快照。
  windowManager.setUITarget(railView.webContents)
  windowManager.setTarget('chrome', chromeView.webContents)

  // IPC 来源判定：优先 webContents.id 精确比对（防 URL 伪造/视图重建后 id 变化），兜底走 URL。
  // 与 ipc/index.ts 注册的 URL 版相比，这里多了"精确身份"，但**判据不是安全边界本身** ——
  // 边界是 CHANNEL_TRUST 声明表 + 前置校验，本函数只负责回答"你是哪个视图"。
  setTrustResolver(event => {
    const id = event.sender.id
    if (railView && id === railView.webContents.id) return 'rail'
    if (chromeView && id === chromeView.webContents.id) return 'chrome'
    if (entryWc && id === entryWc.id) return 'entry'
    return classifyViewUrl(event.sender.getURL())
  })

  // 上一次推送的 active Tab：只有「激活变化」才触发菜单收起，标题/加载态更新不误伤。
  let lastActiveTabId: number | null = null
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
      installTabShortcuts(view.webContents)
      installAssistantShortcut(view.webContents)
      // 菜单外部点击收起（壳 v3）：菜单宿主是独立 rail 视图，点击官方页不会进入 rail 的 DOM 事件。
      // Electron 36 无 before-mouse-event，但 input-event 会携带 mouseDown/pointerDown —— 这是
      // 「点击页面」最直接的主进程信号（焦点事件在窗口未获焦时可能不触发）。
      view.webContents.on('input-event', (_event, input) => {
        if (input.type !== 'mouseDown' && input.type !== 'pointerDown') return
        if (panel.isMenuOpen()) panel.closeMenu()
      })
      // 导航完成恢复该站点缩放（中控台默认 80%，用户记忆优先）
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
        // 模式不再在这里手工切换：active Tab 变成 popup 后由 pushState 派生 browse
        // （后台打开保持当前中控台前台，标签行里新增一张卡，用户可自行切换）。
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
      // 注：页面发起 window.close() 对非脚本打开的 pageView 本就被 Chromium 忽略（无窗口可关），
      // 无需额外守卫；历史 pageCloseGuard 依赖的 did-request-close 在 Electron 36 不存在（幻影 API），已移除。
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
      const activeChanged = state.activeId !== lastActiveTabId
      lastActiveTabId = state.activeId
      // entry 模式没有标签表面：模式只由入口选择/跳过决定，不被后台 Tab 事件改写。
      if (shellMode.mode() === 'entry') return
      // 模式派生（壳 v3 合并）：active Tab 是账号页 → live，自由/弹窗 → browse。
      const active = state.tabs.find(t => t.id === state.activeId)
      const nextMode = active ? shellModeForTabKind(active.kind) : null
      if (nextMode && nextMode !== shellMode.mode()) {
        shellMode.set(nextMode)
        pushShellChromeState()
      }
      // 激活变化 = 表面切换：菜单不得残留到新表面。
      if (activeChanged && panel.isMenuOpen()) panel.closeMenu()
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
    mode: () => shellMode.mode(),
    dockWidth: () => panelWidth,
    applyBounds: b => {
      setChromeHeight(b.chrome.height)
      if (chromeView) chromeView.setBounds(b.chrome)
      if (railView) railView.setBounds(b.rail)
      relayoutEntryView(b.entry)
      tabManager?.applyPageBounds(b.page)
      pushShellChromeState()
    },
    pushRail: s => {
      windowManager.sendTo('ui', IPC_CHANNELS.shell.railState, s)
      // 菜单开合变化同步到 chrome：顶栏据此启用「点其它区域收起」。
      pushShellChromeState()
    },
  })

  // 菜单失焦收起（壳 v3）：任一壳视图获得/失去焦点都视为交互离开菜单。
  // focus 覆盖「点到官方页/入口」，blur 覆盖「焦点从顶栏/菜单移走但目标视图未拿焦」的时序，
  // 两者互补（E2E 无 OS 窗口焦点时 focus 可能不触发，blur 仍可观测）。
  const dismissMenuOnFocus = () => {
    if (panel.isMenuOpen()) panel.closeMenu()
  }
  for (const wc of [chromeView.webContents, railView.webContents, getEntryWebContents()]) {
    if (!wc) continue
    wc.on('focus', dismissMenuOnFocus)
    wc.on('blur', dismissMenuOnFocus)
  }

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
    togglePanel: () => shellRailToggle(null),
  })

  if (process.env.LM_SHELL_DEBUG === '1') registerShellDebug()

  win.once('closed', () => {
    destroyNoticeWindow()
    destroyPanelDragWindow()
    destroyAssistantWindow()
    resetNoticeBus()
    stopEntryStartup()
    destroyEntryView()
    container = null
    chromeView = null
    railView = null
    tabManager = null
    windowManager.clearUITarget()
  })

  logger.success('壳容器已绑定（entry/chrome/rail + Tab 归属）')
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

export function shellTabCloseBatch(ids: number[]) {
  requireTabs().closeBatch(ids)
}

export function shellTabReopen(): number | null {
  return requireTabs().reopenLast()
}

export function shellTabMove(id: number, toIndex: number) {
  requireTabs().moveTab(id, toIndex)
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

/** 面板开合唯一入口（A2）：chrome「展开」与 rail 图标/ESC 同走此处。 */
export function shellRailToggle(routeId?: string | null) {
  if (shellMode.mode() === 'entry') {
    if (!routeId) return
    shellOpenPanel(routeId)
    return
  }
  panel.toggle(routeId ?? null)
  persistLayout()
}

/**
 * 顶栏悬浮菜单开关（壳 v3 · Wave 3 · 计划 §5.2）。
 *
 * **必须复用面板入口的 entry 守卫**：entry 模式下面板本就不该出现（入口=平台选择器），
 * 菜单同理。若新建一条平行 IPC 直连 panelController，就会绕开这个不变量——
 * surfaceController 的「entry 模式关闭 dock」不变量就漏了一个入口。
 *
 * 菜单态**不写持久化**（P1-5）：开关菜单 3 次不应改变 LayoutStore.dockOpen。
 */
export function shellRailMenuToggle() {
  if (shellMode.mode() === 'entry') return
  panel.toggleMenu()
}

/** 选中菜单项：菜单关 + 面板开（选中项）。 */
export function shellRailMenuSelect(routeId: string) {
  if (shellMode.mode() === 'entry') return
  panel.selectMenu(routeId)
  persistLayout()
}

/** chrome 模式快照（唯一消费者是 ShellChrome）：模式 + 菜单开合（用于顶栏点击外部收起）。 */
export function shellChromeSnapshot(): ShellChromeState {
  return { mode: shellMode.mode(), menuOpen: panel.isMenuOpen() }
}

function pushShellChromeState() {
  windowManager.sendTo('chrome', IPC_CHANNELS.shell.modeState, shellChromeSnapshot())
}

export function shellModeSet(mode: ShellMode) {
  applyShellSurface(mode)
}

/** 所有模式变更的唯一表面入口：entry 显隐/page/dock 一起改，禁止调用方各自显隐。 */
export function applyShellSurface(mode: ShellMode, opts: SurfaceOptions = {}) {
  // 表面切换一律先收起顶栏菜单：菜单只属于切换前的表面（与面板互斥同一口径）。
  if (panel.isMenuOpen()) panel.closeMenu()
  const plan = planSurface(mode, opts)
  if (!shellMode.set(mode)) return
  if (plan.entryVisible) showEntry()
  else hideEntry()
  if (plan.closeDock) panel.close()

  if (plan.ensureTab === 'account' && tabManager) {
    const tabs = tabManager.state().tabs
    const account = tabs.find(t => t.kind === 'account')
    if (account) tabManager.activateTab(account.id)
    else if (tabs.length === 0) tabManager.createTab({})
  }
  if (plan.ensureTab === 'free' && tabManager) {
    const tabs = tabManager.state().tabs
    const free = tabs.find(t => t.kind !== 'account')
    if (free) tabManager.activateTab(free.id)
    else tabManager.createTab({})
  }

  if (plan.restoreDock) shellRestoreLayout()
  else if (plan.openDockRoute) panel.open(plan.openDockRoute)
  panel.resize()
  pushShellChromeState()
}

/** 进 live + 打开指定 dock route（rail 图标/展开按钮）。 */
export function shellOpenPanel(routeId?: string | null) {
  applyShellSurface('live', { openDockRoute: routeId ?? null })
  persistLayout()
}

/** 账号移除/显式销毁：只有这里关 account Tab（live surface 的 disposeSurface）。 */
export function shellCloseAccountTab(accountId: string) {
  if (!tabManager) return
  const id = tabManager.tabIdForAccount(accountId)
  if (id != null) tabManager.closeTab(id)
}

function persistLayout() {
  const route = panel.route()
  try {
    saveLayoutState({
      version: LAYOUT_STORE_VERSION,
      dockWidth: panelWidth,
      dockOpen: panel.isOpen(),
      routeId: isKnownShellRouteId(route) ? route : null,
    })
  } catch (error) {
    logger.warn('布局记忆写入失败（不阻断壳操作）：', error)
  }
}

/** railReady 后恢复布局：宽度先应用，再用已知 route 打开 dock；未知 route 视为收起。 */
export function shellRestoreLayout() {
  const saved = loadLayoutState()
  panelWidth = clampDockWidth(saved.dockWidth)
  if (saved.dockOpen && saved.routeId) panel.open(saved.routeId)
  else panel.resize()
}

/** 拖拽开始（rail 视图 pointerdown → 主进程）：记录起点并显示透明导体。 */
export function shellPanelDragBegin(startWidth: number, startScreenX: number) {
  if (!container || container.isDestroyed() || !panel.isOpen()) return
  panelDragStart = { width: clampDockWidth(startWidth), screenX: startScreenX }
  if (!showPanelDragWindow()) logger.warn('面板拖拽导体未就绪，本次拖拽降级为无操作')
}

/** 导体回传 screenX：宽度算术与钳制都在主进程，渲染层不持几何真源。 */
export function shellPanelResize(screenX: number) {
  if (!panelDragStart || !container || container.isDestroyed()) return
  const width = clampDockWidth(
    draggedPanelWidth(panelDragStart.width, panelDragStart.screenX, screenX),
  )
  if (width === panelWidth) return
  panelWidth = width
  panel.resize()
}

export function shellPanelResizeEnd() {
  hidePanelDragWindow()
  panelDragStart = null
  persistLayout()
}

/** AI 浮窗显隐唯一入口：顶栏按钮与 Cmd+J 同走此处；状态推给 chrome。 */
export function shellAssistantToggle(): boolean {
  if (!getAssistantWindowWebContents()) {
    if (!container || !assistantEntry || !assistantPreloadPath) return false
    attachAssistantWindow(container, assistantEntry, assistantPreloadPath)
  }
  const open = toggleAssistantWindow()
  windowManager.sendTo('chrome', IPC_CHANNELS.shell.assistantState, open)
  return open
}

export function shellAssistantClose() {
  hideAssistantWindow()
  windowManager.sendTo('chrome', IPC_CHANNELS.shell.assistantState, false)
}

/** assistant renderer 就绪握手：确认 sender 是 assistant 窗口后设置目标。 */
export function shellAssistantReady(sender: Electron.WebContents) {
  const target = getAssistantWindowWebContents()
  if (target && target.id === sender.id) windowManager.setTarget('assistant', target)
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

/** 账号切换：entry 只切业务上下文；live 下激活/必要时创建该账号 account Tab。 */
export function setActiveAccount(accountId: string) {
  if (!tabManager) return
  const id = tabManager.tabIdForAccount(accountId)
  if (id != null) {
    tabManager.activateTab(id)
    return
  }
  if (shellMode.mode() === 'live') {
    const created = tabManager.createTab({ accountId })
    tabManager.activateTab(created)
  }
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
  const previousUrl = wc.getURL()
  wc.loadURL(`about:blank#${nonce}`).catch(err => logger.error('nonce 页加载失败：', err))
  logger.success('壳 pageView Tab 已就绪（账号：', accountId, '）')
  // v3-7：会话销毁/寻址失败不得关闭 live surface；只把临时 nonce 页恢复回上一页。
  return {
    nonce,
    windowId: wc.id,
    disposeWindow: async () => {
      if (wc.isDestroyed()) return
      if (!wc.getURL().includes(`about:blank#${nonce}`)) return
      const target = /^(https?|file):/.test(previousUrl) ? previousUrl : 'about:blank'
      await wc.loadURL(target).catch(err => logger.warn('nonce 页恢复失败：', err))
    },
  }
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
      mode: shellMode.mode(),
      dockOpen: panel.isOpen(),
      dockWidth: panelWidth,
      activeTabPresent: tabManager.hasActiveTab(),
    })
    const noticeBus = getNoticeBusState()
    const notice = getNoticeWindowDebug()
    const entry = getEntryDebug()
    return {
      panelOpen: panel.isOpen(),
      routeId: panel.route(),
      menuOpen: panel.isMenuOpen(),
      railWidth: bounds.rail.width,
      windowWidth: w,
      windowHeight: h,
      pageBounds: bounds.page,
      entryBounds: bounds.entry,
      expectedEntryBounds: bounds.entry,
      entryVisible: entry.visible,
      entryUrl: entry.url,
      zoomPercent: zoomPercent(currentZoomFactor()),
      shellMode: shellMode.mode(),
      chromeHeight: bounds.chrome.height,
      dockWidth: panelWidth,
      connectedAccountIds: [...accountManager.accountSessions.keys()],
      panelWidth,
      panelDragVisible: isPanelDragWindowVisible(),
      assistantOpen: isAssistantWindowVisible(),
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
          kind: t.kind,
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
  a.__shellModeSet = (mode: ShellMode) => shellModeSet(mode)
  a.__shellModeOpenPanel = (routeId?: string | null) => shellOpenPanel(routeId)
  a.__shellEntryDebug = () => getEntryDebug()
  a.__shellToggle = (routeId?: string | null) => panel.toggle(routeId ?? null)
  // Tab 调试契约（仅 LM_SHELL_DEBUG=1）：窗口级 E2E 用，生产不暴露。
  a.__shellTabCreate = (opts?: { url?: string; accountId?: string }) =>
    tabManager?.createTab(opts ?? {}) ?? null
  a.__shellTabClose = (id: number) => tabManager?.closeTab(id)
  a.__shellTabActivate = (id: number) => tabManager?.activateTab(id)
  a.__shellTabMove = (id: number, toIndex: number) => tabManager?.moveTab(id, toIndex)
  a.__shellTabCloseBatch = (ids: number[]) => tabManager?.closeBatch(ids)
  a.__shellTabReopen = () => tabManager?.reopenLast() ?? null
  a.__shellSendInputEvent = (keyCode: string, modifiers: string[]) => {
    // headless/E2E 下窗口可能从未获得 OS 焦点：回退 chrome 视图，仍走真实 before-input-event。
    const wc =
      electronWebContents.getFocusedWebContents() ??
      chromeView?.webContents ??
      railView?.webContents ??
      getEntryWebContents()
    if (!wc) return null
    wc.sendInputEvent({
      type: 'keyDown',
      keyCode,
      modifiers: modifiers as Electron.InputEvent['modifiers'],
    })
    wc.sendInputEvent({
      type: 'keyUp',
      keyCode,
      modifiers: modifiers as Electron.InputEvent['modifiers'],
    })
    return wc.id
  }
  a.__shellFocusView = (name: 'chrome' | 'rail' | 'page') => {
    const wc =
      name === 'chrome'
        ? chromeView?.webContents
        : name === 'rail'
          ? railView?.webContents
          : (() => {
              const id = tabManager?.activeWebContentsId()
              return id != null ? electronWebContents.fromId(id) : null
            })()
    wc?.focus()
    return wc?.id ?? null
  }
  // AI / 面板拖拽调试契约（仅 LM_SHELL_DEBUG=1）。
  a.__shellAssistantToggle = () => shellAssistantToggle()
  a.__shellAssistantClose = () => shellAssistantClose()
  a.__shellPanelDragBegin = (startWidth: number, startScreenX: number) =>
    shellPanelDragBegin(startWidth, startScreenX)
  a.__shellPanelResize = (screenX: number) => shellPanelResize(screenX)
  a.__shellPanelResizeEnd = () => shellPanelResizeEnd()
  // 测试契约（仅 LM_SHELL_DEBUG=1）：模拟会话层声明/复位弹窗意图，供 E2E 覆盖 intent-navigate 折叠路径
  a.__shellPopupMode = (webContentsId: number, mode: 'navigate' | null) =>
    setPopupMode(webContentsId, mode)
  logger.info('LM_SHELL_DEBUG=1：__shellDebug/__shellToggle 已注册')
}
