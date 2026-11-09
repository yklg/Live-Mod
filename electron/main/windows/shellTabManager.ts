// Tab 唯一归属（guangquan-shell-ui-parity v3）——状态 + 决策在此，Electron 副作用经 deps 注入。
// 契约（shellTabManager.test.ts TC-T1~T11 固化）：
// - 不变量：任意操作序列后 tabs.length ≥ 1 且恰 1 active（末位关闭自动重建空白）。
// - 账号 Tab 幂等复用（v3 openPageView 行为锚）：同 accountId 二次 createTab 返回同一 tabId，不新建不重挂。
// - 挂载恒 index 0（层级铁律 P0-2；chrome=1/rail=2 由 shellUI 负责）。
// - partition：account=`persist:lm-shell-{id}`、free=`persist:lm-shell-browser`（登录态隔离契约 TC-T8）。
// - 事件聚合：did-navigate/page-title-updated/did-start-loading/did-stop-loading 微任务合并一次推送（TC-T10）。
// - 失效自愈：view 外部销毁 → state 过滤、active 迁移、操作不裸抛（TC-T9，S7 同构）。
// - 焦点契约（v2）：create(前台)/activateTab 在可见性切换后调用 view.focus()；close/migrate 不抢焦点；
//   焦点失败经 deps.onFocusError 上报、不阻断激活。非激活 Tab 仍可自动化（保活不变量，E2E 固化）。

export interface TabView {
  webContents: {
    id: number
    getURL: () => string
    getTitle: () => string
    isLoading: () => boolean
    isDestroyed: () => boolean
    canGoBack: () => boolean
    canGoForward: () => boolean
    /** 仅供焦点契约判定：页面 webContents 当前是否持有键盘焦点 */
    isFocused: () => boolean
    loadURL: (u: string) => Promise<void>
    goBack: () => void
    goForward: () => void
    reload: () => void
    close: () => void
    on: (ev: string, fn: (...a: never[]) => void) => void
    off: (ev: string, fn: (...a: never[]) => void) => void
  }
  setVisible: (v: boolean) => void
  setBounds: (b: { x: number; y: number; width: number; height: number }) => void
  /**
   * 键盘焦点接管（v2 焦点契约）：激活路径在可见性应用后调用。
   * 契约：**不得抛错**（实现方内部守卫已销毁/异常），失败只允许经 deps.onFocusError 上报。
   */
  focus: () => void
}

export type TabKind = 'account' | 'free' | 'popup'

export interface TabViewOptions {
  kind: TabKind
  accountId?: string
  partition: string
  /** 账号所属平台的可信域名（弹窗策略跨域 fold 白名单，随会话层注入；free tab 无） */
  popupOrigins?: readonly string[]
}

export interface TabInfo {
  id: number
  title: string
  url: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  active: boolean
  kind: TabKind
}

export interface TabsState {
  tabs: TabInfo[]
  activeId: number
}

export interface ShellTabManagerDeps {
  newView: (opts: TabViewOptions) => TabView
  mount: (view: TabView, index: number) => void
  unmount: (view: TabView) => void
  pushState: (state: TabsState) => void
  /** Tab 集合/激活变化后请求重排：几何真源仍在 panelController，本层不持有任何几何。
   *  不变量（E2E 实证补齐）：运行时新建的 pageView 必须立即拿到 page bounds——
   *  否则新 Tab 的 view 停留在 0×0，直到下一次窗口 resize 才可见（登录页开在壳内却看不见）。
   *  必填而非可选：漏注入会静默退回 0×0 布局，交由编译期拦截（评审 P2 硬化）。 */
  requestLayout: () => void
  /** 焦点接管失败上报（可选）：焦点是增强能力，失败不得阻断 Tab 激活/可见性切换 */
  onFocusError?: (error: unknown) => void
}

export interface ShellTabManager {
  createTab(opts?: { url?: string; accountId?: string; popupOrigins?: readonly string[] }): number
  /**
   * 浏览器语义弹窗承载（fix-shell-popup-navigation-liveend · Phase 2 · v2）：
   * 官方页 window.open 的「新上下文」意图由壳层新 Tab 表达——独立 Tab、复用 opener 的 partition
   * （登录态一致）、不进入账号幂等映射。
   * 激活语义（v2 焦点契约）：默认 **activate:true = 前台激活并接管键盘焦点**；
   * 调用方（shellUI）按「opener 是否为当前 active」传入显式值——后台页自发弹窗应传 false（防抢焦点）。
   * 非激活 Tab 仍必须可被自动化操作（保活不变量，见 poc/shell/e2e-tab-liveness.mjs）。
   */
  createPopupTab(opts: {
    url: string
    partition: string
    activate?: boolean
    popupOrigins?: readonly string[]
  }): number
  closeTab(id: number): void
  /** 批量关闭；逐个走 close 的迁移/不变量逻辑（关闭全部时由 close 重建空白 Tab）。 */
  closeBatch(ids: readonly number[]): void
  /** 仅重开最近关闭的 free/popup Tab；账号 Tab 由账号上下文恢复，不入栈。 */
  reopenLast(): number | null
  /** 只重排数组：不改 active/mounted，不触发重排，只推 state。 */
  moveTab(id: number, toIndex: number): void
  activateTab(id: number): void
  navigate(id: number, url: string): Promise<void>
  goBack(id: number): void
  goForward(id: number): void
  reload(id: number): void
  tabIdForAccount(accountId: string): number | null
  webContentsIdOf(tabId: number): number
  /**
   * 当前 active Tab 的 webContents id；无 active/已销毁 → null（不抛错）。
   * 消费方：shellUI 弹窗门控（openerActive 判定）与调试契约。
   */
  activeWebContentsId(): number | null
  /** 导航离开护栏/会话层查询用 */
  tabInfoOf(tabId: number): { kind: TabKind; accountId: string | null } | null
  hasActiveTab(): boolean
  /** 面板控制器算好 page bounds 后应用到 active view（无 active → 空操作） */
  applyPageBounds(b: { x: number; y: number; width: number; height: number } | null): void
  state(): TabsState
}

const BRIDGE_EVENTS = [
  'did-navigate',
  'did-navigate-in-page',
  'page-title-updated',
  'did-start-loading',
  'did-stop-loading',
] as const

/**
 * 账号 Tab partition 名唯一真源（v3·P1 配对契约）：
 * createTab 建 view 与 ipc/shell resetLoginState 清登录态必须同源，禁止第二处字面量。
 */
export function accountTabPartition(accountId: string): string {
  return `persist:lm-shell-${accountId}`
}

export const FREE_TAB_PARTITION = 'persist:lm-shell-browser'

export function createShellTabManager(deps: ShellTabManagerDeps): ShellTabManager {
  interface Tab {
    id: number
    kind: TabKind
    accountId: string | null
    view: TabView
    /** 是否已挂载到容器（后台 Tab 延迟挂载：避免隐藏 view 夺走/清空键盘焦点） */
    mounted: boolean
    partition: string
    popupOrigins?: readonly string[]
  }
  interface ClosedTab {
    url: string
    title: string
    kind: 'free' | 'popup'
    partition: string
    popupOrigins?: readonly string[]
  }
  const CLOSED_LIMIT = 10
  let seq = 0
  let activeId = 0
  const tabs: Tab[] = []
  const closedStack: ClosedTab[] = []
  const accountIndex = new Map<string, number>()
  let pushScheduled = false

  const alive = (t: Tab) => !t.view.webContents.isDestroyed()

  const buildState = (): TabsState => ({
    tabs: tabs.map(t => ({
      id: t.id,
      title: t.view.webContents.getTitle(),
      url: t.view.webContents.getURL(),
      loading: t.view.webContents.isLoading(),
      canBack: t.view.webContents.canGoBack(),
      canForward: t.view.webContents.canGoForward(),
      active: t.id === activeId,
      kind: t.kind,
    })),
    activeId,
  })

  const pushNow = () => deps.pushState(buildState())

  // 同帧多事件合并为一次推送（TC-T10）；同步操作直接推
  const pushSoon = () => {
    if (pushScheduled) return
    pushScheduled = true
    queueMicrotask(() => {
      pushScheduled = false
      pushNow()
    })
  }

  const applyVisibility = () => {
    for (const t of tabs) if (alive(t)) t.view.setVisible(t.id === activeId)
  }

  const migrateActiveIfNeeded = () => {
    const active = tabs.find(t => t.id === activeId)
    if (active && alive(active)) return
    const next = tabs.find(t => alive(t))
    if (next) {
      if (!next.mounted) {
        deps.mount(next.view, 0)
        next.mounted = true
      }
      activeId = next.id
      applyVisibility()
    }
  }

  /**
   * 激活路径统一焦点接管（v2）：仅 create(前台)/activateTab 调用；
   * close/migrate 刻意不调用（关闭 Tab 不得抢焦点）。
   */
  const focusActive = () => {
    const t = tabs.find(tab => tab.id === activeId && alive(tab))
    if (!t) return
    try {
      t.view.focus()
    } catch (error) {
      // 焦点是增强能力：失败不影响激活/可见性/几何，仅上报观测
      deps.onFocusError?.(error)
    }
  }

  const create = (opts: {
    url?: string
    accountId?: string
    popupOrigins?: readonly string[]
    /** popup 专用：显式 partition（opener 的账号 partition）；kind 默认按 accountId 推导 */
    kind?: TabKind
    partition?: string
    /** false = 后台打开（保留当前 active Tab）；默认 true（浏览器式前台） */
    activate?: boolean
  }): number => {
    if (opts.accountId) {
      const existing = accountIndex.get(opts.accountId)
      if (existing !== undefined && tabs.some(t => t.id === existing && alive(t))) {
        // 行为锚：复用不新建、不二次挂载；激活既有 Tab（激活同样请求重排，幂等）
        activeId = existing
        applyVisibility()
        pushNow()
        deps.requestLayout()
        return existing
      }
    }
    seq += 1
    const id = seq
    const kind: TabKind = opts.kind ?? (opts.accountId ? 'account' : 'free')
    const partition =
      opts.partition ?? (opts.accountId ? accountTabPartition(opts.accountId) : FREE_TAB_PARTITION)
    // 焦点契约（v2）：后台打开可能因新建/隐藏 view 导致既有页面焦点丢失（实测评测为 null），
    // 若打开前焦点在某个页面 Tab 上，创建后要把它还回去；焦点在面板/顶栏时不得抢占。
    const focusWasInPageTab = tabs.some(t => alive(t) && t.view.webContents.isFocused())
    const foreground = opts.activate !== false
    const view = deps.newView({
      kind,
      accountId: opts.accountId,
      partition,
      popupOrigins: opts.popupOrigins,
    })
    for (const ev of BRIDGE_EVENTS) view.webContents.on(ev, () => pushSoon())
    // 后台打开：**延迟挂载**。实测「创建并隐藏隐藏 WebContentsView」会让既有页面焦点全部丢失
    // 且无法恢复（isFocused 全 false）——后台 Tab 不挂载即可完全避免该副作用，用户切换到该 Tab 时再挂载。
    const mountNow = foreground
    if (mountNow) deps.mount(view, 0) // 层级铁律：pageView 恒 index 0
    tabs.push({
      id,
      kind,
      accountId: opts.accountId ?? null,
      view,
      mounted: mountNow,
      partition,
      popupOrigins: opts.popupOrigins,
    })
    if (opts.accountId) accountIndex.set(opts.accountId, id)
    const prevActiveId = activeId
    activeId = id
    // 后台打开语义（popup 默认）：不抢 active，但新 view 仍需可见性/几何正确（由 create 末尾重排保证）
    if (opts.activate === false && prevActiveId !== 0) activeId = prevActiveId
    applyVisibility()
    if (opts.url) void view.webContents.loadURL(opts.url).catch(() => {})
    pushNow()
    // 新 Tab 的 view 刚 mount 时 bounds 为 0×0；必须立刻让布局层重排（几何仍由 panelController 唯一裁决）
    deps.requestLayout()
    // 焦点契约（v2）：前台激活在可见性/几何就绪后接管键盘焦点；
    // 后台打开不主动抢焦点，但若打开前焦点在页面 Tab 上，则恢复到 active 页（防焦点丢为 null）。
    if (foreground || focusWasInPageTab) focusActive()
    return id
  }

  const find = (id: number) => tabs.find(t => t.id === id)

  const close = (id: number) => {
    const idx = tabs.findIndex(t => t.id === id)
    if (idx < 0) return // 幂等：未知/已关 id 空操作（TC-T4）
    const [t] = tabs.splice(idx, 1)
    // 账号 Tab 由账号上下文恢复，不入重开栈；free/popup 保留 URL/partition 以支持 Cmd+Shift+T。
    if (t.kind !== 'account') {
      closedStack.push({
        url: t.view.webContents.getURL(),
        title: t.view.webContents.getTitle(),
        kind: t.kind,
        partition: t.partition,
        popupOrigins: t.popupOrigins,
      })
      if (closedStack.length > CLOSED_LIMIT) closedStack.shift()
    }
    if (t.accountId) accountIndex.delete(t.accountId)
    if (t.mounted) deps.unmount(t.view)
    if (tabs.length === 0) {
      create({}) // 不变量：末位关闭重建空白，不退出
      return
    }
    if (activeId === id) {
      // 右邻优先，无右邻取左邻（TC-T3）；splice 后 idx 位置即原右邻
      const next = tabs[idx] ?? tabs[idx - 1] ?? tabs[0]
      activeId = next.id
    }
    applyVisibility()
    pushNow()
    deps.requestLayout()
  }

  const closeBatch = (ids: readonly number[]) => {
    for (const id of new Set(ids)) close(id)
  }

  const reopenLast = (): number | null => {
    const closed = closedStack.pop()
    if (!closed) return null
    return create({
      url: closed.url,
      kind: closed.kind,
      partition: closed.partition,
      popupOrigins: closed.popupOrigins,
      activate: true,
    })
  }

  const moveTab = (id: number, toIndex: number) => {
    const from = tabs.findIndex(t => t.id === id)
    if (from < 0) return
    const to = Math.max(0, Math.min(tabs.length - 1, Math.round(toIndex)))
    if (to === from) return
    const [t] = tabs.splice(from, 1)
    tabs.splice(to, 0, t)
    pushNow()
  }

  return {
    createTab: create,
    createPopupTab(opts) {
      return create({
        url: opts.url,
        kind: 'popup',
        partition: opts.partition,
        popupOrigins: opts.popupOrigins,
        activate: opts.activate ?? true,
      })
    },
    closeTab: close,
    closeBatch,
    reopenLast,
    moveTab,
    activateTab(id) {
      const t = find(id)
      if (!t || !alive(t) || t.id === activeId) return
      if (!t.mounted) {
        // 后台创建的 Tab 首次激活：此时才挂载，可见性/几何由下方 applyVisibility + requestLayout 统一裁决
        deps.mount(t.view, 0)
        t.mounted = true
      }
      activeId = id
      applyVisibility()
      pushNow()
      deps.requestLayout()
      // 显式切换 Tab = 用户意图；焦点随可见性进入新页面（浏览器一致）
      focusActive()
    },
    async navigate(id, url) {
      const t = find(id)
      if (!t || !alive(t)) throw new Error(`tab ${id} 不存在或已销毁`)
      await t.view.webContents.loadURL(url)
    },
    goBack(id) {
      const t = find(id)
      if (t && alive(t)) t.view.webContents.goBack()
    },
    goForward(id) {
      const t = find(id)
      if (t && alive(t)) t.view.webContents.goForward()
    },
    reload(id) {
      const t = find(id)
      if (t && alive(t)) t.view.webContents.reload()
    },
    tabIdForAccount(accountId) {
      const id = accountIndex.get(accountId)
      if (id === undefined) return null
      const t = find(id)
      return t && alive(t) ? id : null
    },
    webContentsIdOf(tabId) {
      const t = find(tabId)
      if (!t) throw new Error(`tab ${tabId} 不存在`)
      return t.view.webContents.id
    },
    activeWebContentsId() {
      const t = tabs.find(tab => tab.id === activeId && alive(tab))
      return t ? t.view.webContents.id : null
    },
    tabInfoOf(tabId) {
      const t = find(tabId)
      if (!t || !alive(t)) return null
      return { kind: t.kind, accountId: t.accountId }
    },
    hasActiveTab() {
      migrateActiveIfNeeded()
      return tabs.some(t => t.id === activeId && alive(t))
    },
    applyPageBounds(b) {
      const active = tabs.find(t => t.id === activeId && alive(t))
      if (active && b) active.view.setBounds(b)
    },
    state() {
      // 失效自愈（TC-T9）：过滤已销毁 view，active 销毁则迁移。
      // 注意 state() 是查询接口但带布局副作用（pruned → requestLayout）：自愈后 active/bounds 已变，
      // 与 create/activate/close 同语义；仅 prune 时触发，正常查询零副作用。
      let pruned = false
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (!alive(tabs[i])) {
          const [dead] = tabs.splice(i, 1)
          if (dead.accountId) accountIndex.delete(dead.accountId)
          pruned = true
        }
      }
      if (tabs.length === 0) {
        create({})
      } else {
        migrateActiveIfNeeded()
        // 自愈后 active/bounds 都可能变化，补一次重排（与 create/activate/close 同语义）
        if (pruned) deps.requestLayout()
      }
      return buildState()
    },
  }
}
