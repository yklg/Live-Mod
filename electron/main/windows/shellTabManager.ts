// Tab 唯一归属（guangquan-shell-ui-parity v3）——状态 + 决策在此，Electron 副作用经 deps 注入。
// 契约（shellTabManager.test.ts TC-T1~T11 固化）：
// - 不变量：任意操作序列后 tabs.length ≥ 1 且恰 1 active（末位关闭自动重建空白）。
// - 账号 Tab 幂等复用（v3 openPageView 行为锚）：同 accountId 二次 createTab 返回同一 tabId，不新建不重挂。
// - 挂载恒 index 0（层级铁律 P0-2；chrome=1/rail=2 由 shellUI 负责）。
// - partition：account=`persist:lm-shell-{id}`、free=`persist:lm-shell-browser`（登录态隔离契约 TC-T8）。
// - 事件聚合：did-navigate/page-title-updated/did-start-loading/did-stop-loading 微任务合并一次推送（TC-T10）。
// - 失效自愈：view 外部销毁 → state 过滤、active 迁移、操作不裸抛（TC-T9，S7 同构）。

export interface TabView {
  webContents: {
    id: number
    getURL: () => string
    getTitle: () => string
    isLoading: () => boolean
    isDestroyed: () => boolean
    canGoBack: () => boolean
    canGoForward: () => boolean
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
}

export interface TabViewOptions {
  kind: 'account' | 'free'
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
}

export interface ShellTabManager {
  createTab(opts?: { url?: string; accountId?: string; popupOrigins?: readonly string[] }): number
  closeTab(id: number): void
  activateTab(id: number): void
  navigate(id: number, url: string): Promise<void>
  goBack(id: number): void
  goForward(id: number): void
  reload(id: number): void
  tabIdForAccount(accountId: string): number | null
  webContentsIdOf(tabId: number): number
  /** 导航离开护栏/会话层查询用 */
  tabInfoOf(tabId: number): { kind: 'account' | 'free'; accountId: string | null } | null
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
    kind: 'account' | 'free'
    accountId: string | null
    view: TabView
  }
  let seq = 0
  let activeId = 0
  const tabs: Tab[] = []
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
      activeId = next.id
      applyVisibility()
    }
  }

  const create = (opts: {
    url?: string
    accountId?: string
    popupOrigins?: readonly string[]
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
    const kind: 'account' | 'free' = opts.accountId ? 'account' : 'free'
    const view = deps.newView({
      kind,
      accountId: opts.accountId,
      partition: opts.accountId ? accountTabPartition(opts.accountId) : FREE_TAB_PARTITION,
      popupOrigins: opts.popupOrigins,
    })
    for (const ev of BRIDGE_EVENTS) view.webContents.on(ev, () => pushSoon())
    deps.mount(view, 0) // 层级铁律：pageView 恒 index 0
    tabs.push({ id, kind, accountId: opts.accountId ?? null, view })
    if (opts.accountId) accountIndex.set(opts.accountId, id)
    activeId = id
    applyVisibility()
    if (opts.url) void view.webContents.loadURL(opts.url).catch(() => {})
    pushNow()
    // 新 Tab 的 view 刚 mount 时 bounds 为 0×0；必须立刻让布局层重排（几何仍由 panelController 唯一裁决）
    deps.requestLayout()
    return id
  }

  const find = (id: number) => tabs.find(t => t.id === id)

  const close = (id: number) => {
    const idx = tabs.findIndex(t => t.id === id)
    if (idx < 0) return // 幂等：未知/已关 id 空操作（TC-T4）
    const [t] = tabs.splice(idx, 1)
    if (t.accountId) accountIndex.delete(t.accountId)
    deps.unmount(t.view)
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

  return {
    createTab: create,
    closeTab: close,
    activateTab(id) {
      const t = find(id)
      if (!t || !alive(t) || t.id === activeId) return
      activeId = id
      applyVisibility()
      pushNow()
      deps.requestLayout()
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
