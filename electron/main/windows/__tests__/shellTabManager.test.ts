import { describe, expect, it, vi } from 'vitest'
import {
  accountTabPartition,
  createShellTabManager,
  FREE_TAB_PARTITION,
  type TabsState,
  type TabView,
} from '#/windows/shellTabManager'

// ===== Tab 唯一归属（guangquan-shell-ui-parity v3）=====
// 契约（实现方必须满足，红灯基线即规格）：
// - createShellTabManager(deps)：deps = { newView(opts), mount(view,index), unmount(view), pushState(state), requestLayout() }
//   requestLayout 必填：Tab 生命周期变化后请求布局层重排（TC-T12；漏注入=新 Tab 停在 0×0）。
// - newView opts = { kind:'account'|'free', accountId?, partition }；账号 Tab partition=`persist:lm-shell-{accountId}`，
//   自由 Tab partition=`persist:lm-shell-browser`（TC-T8 固化，登录态隔离契约）。
// - mount(view, 0)：pageView 恒 index 0（层级铁律 P0-2；chrome=1/rail=2 由 shellUI 负责，不在本层）。
// - createTab({accountId}) 幂等复用：同账号二次调用返回同一 tabId，不 newView、不二次 mount（TC-T2/T6，v3 openPageView 行为锚）。
// - 不变量：任意操作序列后 tabs.length ≥ 1 且恰有 1 个 active（TC-T1）。
// - 事件聚合：did-navigate / page-title-updated / did-start-loading / did-stop-loading 同帧多次触发
//   → pushState 微任务合并为一次，payload 为末态（TC-T10）。
// - state() 过滤已销毁 view；active 销毁则自愈迁移（TC-T9）。
// - 辅助寻址：webContentsIdOf(tabId) → view.webContents.id（shellWindowManager.open 返回 windowId 的同源，TC-T4/T9 依赖）。

type FakeWC = {
  id: number
  url: string
  title: string
  loading: boolean
  destroyed: boolean
  canB: boolean
  canF: boolean
  focused: boolean
  isFocused: () => boolean
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
  on: (ev: string, fn: (...a: unknown[]) => void) => void
  off: (ev: string, fn: (...a: unknown[]) => void) => void
}

function makeFakeView(id: number) {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
  /** 焦点契约（v2）观测序列：visible:* 与 focus 的调用顺序用于断言「先可见后聚焦」 */
  const seq: string[] = []
  const wc: FakeWC = {
    id,
    url: 'about:blank',
    title: '',
    loading: false,
    destroyed: false,
    canB: false,
    canF: false,
    focused: false,
    getURL: () => wc.url,
    getTitle: () => wc.title,
    isLoading: () => wc.loading,
    isDestroyed: () => wc.destroyed,
    canGoBack: () => wc.canB,
    canGoForward: () => wc.canF,
    isFocused: () => wc.focused,
    loadURL: vi.fn(async (u: string) => {
      wc.url = u
    }),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    close: vi.fn(() => {
      wc.destroyed = true
    }),
    on: (ev, fn) => {
      if (!handlers[ev]) handlers[ev] = []
      handlers[ev].push(fn)
    },
    off: (ev, fn) => {
      handlers[ev] = (handlers[ev] || []).filter(f => f !== fn)
    },
  }
  const setVisible = vi.fn((v: boolean) => {
    seq.push(v ? 'visible:true' : 'visible:false')
  })
  const focus = vi.fn(() => {
    seq.push('focus')
  })
  const view: TabView = {
    webContents: wc as unknown as TabView['webContents'],
    setVisible,
    setBounds: vi.fn(),
    focus,
  }
  const emit = (ev: string, ...args: unknown[]) => {
    const fns = (handlers[ev] || []).slice()
    for (const fn of fns) fn(...args)
  }
  return { view, wc, emit, seq, setVisible, focus }
}

function setup() {
  let seq = 0
  const viewsById = new Map<number, ReturnType<typeof makeFakeView>>()
  const newView = vi.fn(
    (opts: {
      kind: string
      accountId?: string
      partition: string
      popupOrigins?: readonly string[]
    }) => {
      seq += 1
      const f = makeFakeView(100 + seq)
      f.wc.url =
        opts.kind === 'account' ? `about:blank#lm-nonce-${opts.accountId}-${seq}` : 'about:blank'
      viewsById.set(f.view.webContents.id, f)
      return f.view
    },
  )
  const mounts: Array<{ wcId: number; index: number }> = []
  const unmounts: number[] = []
  const pushes: TabsState[] = []
  const focusErrors: unknown[] = []
  let layoutCalls = 0
  const manager = createShellTabManager({
    newView,
    mount: (view, index) => mounts.push({ wcId: view.webContents.id, index }),
    unmount: view => {
      unmounts.push(view.webContents.id)
      view.webContents.close()
    },
    pushState: s => pushes.push(s),
    requestLayout: () => {
      layoutCalls += 1
    },
    onFocusError: e => focusErrors.push(e),
  })
  const flush = () => Promise.resolve().then(() => Promise.resolve())
  const lastState = () => pushes[pushes.length - 1]
  const layoutCallsOf = () => layoutCalls
  const fakeOf = (tabId: number) => {
    const wcId = manager.webContentsIdOf(tabId)
    const f = viewsById.get(wcId)
    if (!f) throw new Error(`fake view 缺失：tab ${tabId}`)
    return f
  }
  return {
    manager,
    newView,
    mounts,
    unmounts,
    pushes,
    viewsById,
    flush,
    lastState,
    layoutCallsOf,
    fakeOf,
    focusErrors,
  }
}

describe('shellTabManager 生命周期不变量（TC-T1~T3）', () => {
  it('TC-T1 [INV] 任意操作序列后恒 ≥1 Tab 且恰 1 active', () => {
    const f = setup()
    const check = (label: string) => {
      const s = f.manager.state()
      expect(s.tabs.length, label).toBeGreaterThanOrEqual(1)
      expect(
        s.tabs.filter(t => t.active),
        label,
      ).toHaveLength(1)
      expect(s.activeId, label).toBe(s.tabs.find(t => t.active)?.id)
    }
    const t1 = f.manager.createTab({})
    check('建1')
    const t2 = f.manager.createTab({})
    check('建2')
    f.manager.activateTab(t1)
    check('切1')
    f.manager.closeTab(t1)
    check('关active')
    f.manager.createTab({})
    check('再建')
    f.manager.closeTab(t2)
    check('关非active')
    const last = f.manager.state().tabs[0].id
    f.manager.closeTab(last)
    check('关最后一个→重建空白')
    expect(f.manager.state().tabs).toHaveLength(1)
    expect(f.manager.state().tabs[0].url).toBe('about:blank')
  })

  it('TC-T2 [账号复用·P0 行为锚] 同 accountId 二次 createTab 返回同一 tabId，不新建 view 不二次挂载', () => {
    const f = setup()
    const a = f.manager.createTab({ accountId: 'a1' })
    const b = f.manager.createTab({ accountId: 'a1' })
    expect(b).toBe(a)
    expect(f.newView).toHaveBeenCalledTimes(1)
    expect(f.manager.tabIdForAccount('a1')).toBe(a)
    expect(f.manager.tabIdForAccount('a2')).toBeNull()
  })

  it('TC-T3 [迁移规则] 关 active 取右邻、无右邻取左邻；关非 active 不改 active', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    const t2 = f.manager.createTab({})
    const t3 = f.manager.createTab({}) // active=t3
    f.manager.closeTab(t3)
    expect(f.manager.state().activeId).toBe(t2) // 右邻不存在→左邻
    f.manager.closeTab(t1) // 非 active
    expect(f.manager.state().activeId).toBe(t2)
  })
})

describe('shellTabManager 守卫与隔离（TC-T4~T8）', () => {
  it('TC-T4 [幂等·teardown 同型] closeTab 双调 unmount 恰好一次', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    f.manager.createTab({}) // 保证 t1 关闭不触发末位重建
    const wcId1 = f.manager.webContentsIdOf(t1)
    f.manager.closeTab(t1)
    f.manager.closeTab(t1)
    expect(f.unmounts.filter(x => x === wcId1)).toHaveLength(1)
  })

  it('TC-T5 [z-order] pageView 挂载恒 index 0', () => {
    const f = setup()
    f.manager.createTab({})
    f.manager.createTab({ accountId: 'a1' })
    f.manager.createTab({})
    expect(f.mounts).toHaveLength(3)
    expect(f.mounts.every(m => m.index === 0)).toBe(true)
  })

  it('TC-T6 [双挂禁止·外部经验] 同一 view 不会被 mount 第二次（WebContents 单 view 约束）', () => {
    const f = setup()
    f.manager.createTab({ accountId: 'a1' })
    f.manager.createTab({ accountId: 'a1' }) // 复用路径
    f.manager.createTab({ accountId: 'a1' })
    const seen = new Set<number>()
    for (const m of f.mounts) {
      expect(seen.has(m.wcId), `wc ${m.wcId} 重复挂载`).toBe(false)
      seen.add(m.wcId)
    }
    expect(f.mounts).toHaveLength(1)
  })

  it('TC-T7 [并发隔离·pageFactory 同构] 两账号并行各归各 Tab，关一个不波及另一个', () => {
    const f = setup()
    const a1 = f.manager.createTab({ accountId: 'a1' })
    const a2 = f.manager.createTab({ accountId: 'a2' })
    expect(a1).not.toBe(a2)
    expect(f.manager.tabIdForAccount('a1')).toBe(a1)
    expect(f.manager.tabIdForAccount('a2')).toBe(a2)
    const f2 = f.fakeOf(a2)
    f.manager.closeTab(a1)
    expect(f.manager.tabIdForAccount('a2')).toBe(a2)
    expect(f2.wc.destroyed).toBe(false)
    expect(f.manager.state().tabs.some(t => t.id === a2)).toBe(true)
  })

  it('TC-T8 [partition 契约] account=persist:lm-shell-{id}，free=persist:lm-shell-browser', () => {
    const f = setup()
    f.manager.createTab({ accountId: 'a1' })
    f.manager.createTab({})
    const opts = f.newView.mock.calls.map(c => c[0])
    expect(opts[0]).toMatchObject({
      kind: 'account',
      accountId: 'a1',
      partition: accountTabPartition('a1'),
    })
    expect(accountTabPartition('a1')).toBe('persist:lm-shell-a1') // 真源格式固化（resetLoginState 同源）
    expect(opts[1]).toMatchObject({ kind: 'free', partition: FREE_TAB_PARTITION })
  })
})

describe('shellTabManager 异常与事件桥（TC-T9~T11）', () => {
  it('TC-T9 [失效容错·S7 同构] view 外部销毁：state 过滤、active 自愈、操作不裸抛', async () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    const t2 = f.manager.createTab({}) // active=t2
    f.fakeOf(t2).wc.destroyed = true
    const s = f.manager.state()
    expect(s.tabs.some(t => t.id === t2)).toBe(false)
    expect(s.activeId).toBe(t1)
    await expect(f.manager.navigate(t2, 'https://x.com')).rejects.toBeDefined()
    expect(() => f.manager.reload(t2)).not.toThrow()
    expect(() => f.manager.activateTab(t2)).not.toThrow()
  })

  it('TC-T10 [同帧聚合·TC-U4 同构] did-navigate + page-title-updated → 微任务合并一次推送且末态正确', async () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    const before = f.pushes.length
    const fake = f.fakeOf(t1)
    fake.wc.url = 'https://buyin.jinritemai.com/dashboard/live/control'
    fake.wc.title = '直播中控'
    fake.emit('did-navigate', fake.wc.url)
    fake.emit('page-title-updated', fake.wc.title)
    await f.flush()
    const added = f.pushes.length - before
    expect(added).toBe(1)
    const tab = f.lastState().tabs.find(t => t.id === t1)
    expect(tab?.url).toBe('https://buyin.jinritemai.com/dashboard/live/control')
    expect(tab?.title).toBe('直播中控')
  })

  it('TC-T11 [配对契约] canBack/canForward 与 view.canGoBack/canGoForward 同源', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    const fake = f.fakeOf(t1)
    fake.wc.canB = true
    fake.wc.canF = false
    const tab = f.manager.state().tabs.find(t => t.id === t1)
    expect(tab?.canBack).toBe(true)
    expect(tab?.canForward).toBe(false)
  })

  // E2E 实证补齐（壳内登录验收 V4）：运行时新建 pageView 初始 bounds=0×0，
  // 若不等布局层重排，登录页开在壳内 Tab 却不可见（仅下一次 resize 才恢复）。
  it('TC-T13 [弹窗策略透传] 账号 Tab 的 popupOrigins 原样交给 newView（跨域登录 fold 白名单）', () => {
    const f = setup()
    f.manager.createTab({ accountId: 'a1', popupOrigins: ['jinritemai.com', 'douyinec.com'] })
    const opts = f.newView.mock.calls.at(-1)?.[0]
    expect(opts).toMatchObject({
      accountId: 'a1',
      popupOrigins: ['jinritemai.com', 'douyinec.com'],
    })
    f.manager.createTab({}) // free tab 不携带
    expect(f.newView.mock.calls.at(-1)?.[0]?.popupOrigins).toBeUndefined()
  })

  it('TC-T12 [重排契约] 新建/复用/激活/关闭 Tab 后都请求重排（几何仍归 panelController）', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    expect(f.layoutCallsOf()).toBe(1) // 新建 → 重排
    const t2 = f.manager.createTab({ accountId: 'a1' })
    expect(f.layoutCallsOf()).toBe(2)
    f.manager.createTab({ accountId: 'a1' }) // 复用路径同样激活
    expect(f.layoutCallsOf()).toBe(3)
    f.manager.activateTab(t1)
    expect(f.layoutCallsOf()).toBe(4)
    f.manager.closeTab(t2)
    expect(f.layoutCallsOf()).toBe(5)
    // 幂等/空操作不制造多余重排
    f.manager.activateTab(t1) // 已是 active
    expect(f.layoutCallsOf()).toBe(5)
    f.manager.closeTab(999) // 未知 id
    expect(f.layoutCallsOf()).toBe(5)
  })
})

// ===== 浏览器语义弹窗承载（fix-shell-popup-navigation-liveend · Phase 2 · A1）=====
// 契约：
// - createPopupTab 使用 opener 的显式 partition（登录态一致），kind='popup'，不进入账号幂等映射；
// - 默认**后台打开**（不抢 active Tab：任务/会话依赖中控台页保持前台运行）；activate:true 时前台；
// - popup Tab 与账号 Tab 生命周期解耦：关 popup 不影响 accountIndex；关 account 不波及 popup。
describe('shellTabManager 弹窗 Tab（TC-T14~T16）', () => {
  it('TC-T14 [partition 透传·kind] 弹窗 Tab 使用显式账号 partition，kind=popup，且不占账号映射', () => {
    const f = setup()
    const accountTab = f.manager.createTab({ accountId: 'a1' })
    const popupTab = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/screen/anchor/shop?live_room_id=1',
      partition: accountTabPartition('a1'),
      popupOrigins: ['jinritemai.com'],
    })
    expect(popupTab).not.toBe(accountTab)
    const opts = f.newView.mock.calls.at(-1)?.[0]
    expect(opts).toMatchObject({
      kind: 'popup',
      partition: accountTabPartition('a1'),
      popupOrigins: ['jinritemai.com'],
    })
    expect(opts?.accountId).toBeUndefined()
    // 账号幂等映射不被 popup 污染
    expect(f.manager.tabIdForAccount('a1')).toBe(accountTab)
    expect(f.manager.tabInfoOf(popupTab)).toEqual({ kind: 'popup', accountId: null })
    expect(f.manager.tabInfoOf(accountTab)).toEqual({ kind: 'account', accountId: 'a1' })
    const popupFake = f.fakeOf(popupTab)
    expect(popupFake.wc.url).toBe(
      'https://compass.jinritemai.com/screen/anchor/shop?live_room_id=1',
    )
  })

  it('TC-T15 [前台打开·v2] 默认前台激活并接管焦点；显式 activate:false 才后台', () => {
    const f = setup()
    const accountTab = f.manager.createTab({ accountId: 'a1' })
    const popupTab = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/x',
      partition: accountTabPartition('a1'),
    })
    expect(f.manager.state().activeId).toBe(popupTab) // v2：默认前台（浏览器语义）
    expect(f.fakeOf(popupTab).view.setVisible).toHaveBeenLastCalledWith(true)
    expect(f.fakeOf(accountTab).view.setVisible).toHaveBeenLastCalledWith(false)
    expect(f.fakeOf(popupTab).focus).toHaveBeenCalledTimes(1) // 焦点契约

    const back = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/y',
      partition: accountTabPartition('a1'),
      activate: false,
    })
    expect(f.manager.state().activeId).toBe(popupTab) // 后台：不抢 active
    expect(f.fakeOf(back).view.setVisible).toHaveBeenLastCalledWith(false)
    expect(f.fakeOf(back).focus).not.toHaveBeenCalled()
  })

  it('TC-T16 [生命周期解耦] 关 popup 不影响账号映射/active；关账号不波及 popup 内容', () => {
    const f = setup()
    const accountTab = f.manager.createTab({ accountId: 'a1' })
    const popupTab = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/x',
      partition: accountTabPartition('a1'),
    })
    f.manager.closeTab(popupTab)
    expect(f.manager.tabIdForAccount('a1')).toBe(accountTab)
    expect(f.manager.state().tabs.some(t => t.id === popupTab)).toBe(false)
    // 再开一个 popup，关闭账号 Tab 时它仍存活（popup 不随账号复用/迁移）
    const popup2 = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/z',
      partition: accountTabPartition('a1'),
    })
    f.manager.closeTab(accountTab)
    expect(f.manager.state().tabs.some(t => t.id === popup2)).toBe(true)
    expect(f.manager.tabIdForAccount('a1')).toBeNull()
    expect(f.fakeOf(popup2).wc.destroyed).toBe(false)
  })
})

// ===== v2 焦点契约 + activeWebContentsId（fix-shell-popup-navigation-liveend · v2）=====
// 契约：
// - 前台激活（create 默认 / activate:true）= 可见性切换后 focus 一次；
// - 后台打开（activate:false）= 不碰焦点；
// - activateTab = 可见性切换后 focus；重复激活/close/migrate 不抢焦点；
// - focus 抛错不冒泡，经 onFocusError 上报（不影响激活）；
// - activeWebContentsId 返回存活 active 的 wc id，无 active → null（不抛）。
describe('shellTabManager 焦点契约（TC-T17~T20）', () => {
  it('TC-T17 [顺序契约] create 前台：先 setVisible(true) 后 focus（不得倒序）', () => {
    const f = setup()
    f.manager.createTab({ accountId: 'a1' })
    const popupTab = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/x',
      partition: accountTabPartition('a1'),
    })
    const seq = f.fakeOf(popupTab).seq
    expect(seq.indexOf('visible:true')).toBeGreaterThanOrEqual(0)
    expect(seq.indexOf('focus')).toBeGreaterThan(seq.indexOf('visible:true'))
  })

  it('TC-T18 [activateTab 聚焦·存量修复] 显式切换后聚焦新 active；重复激活不重复聚焦', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    const t2 = f.manager.createTab({})
    // create 阶段也会聚焦（默认前台）；清空调用计数后只观察 activateTab 的行为
    f.fakeOf(t1).focus.mockClear()
    f.fakeOf(t2).focus.mockClear()
    f.manager.activateTab(t1)
    expect(f.fakeOf(t1).focus).toHaveBeenCalledTimes(1)
    f.manager.activateTab(t1) // 已是 active：幂等，不重复聚焦
    expect(f.fakeOf(t1).focus).toHaveBeenCalledTimes(1)
    expect(f.fakeOf(t2).focus).not.toHaveBeenCalled()
  })

  it('TC-T19 [不抢焦点] close/migrate 不调用 focus', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    const t2 = f.manager.createTab({})
    const t1FocusBefore = f.fakeOf(t1).focus.mock.calls.length
    const t2FocusBefore = f.fakeOf(t2).focus.mock.calls.length
    f.manager.closeTab(t2) // 关 active → 迁移到 t1
    expect(f.manager.state().activeId).toBe(t1)
    expect(f.fakeOf(t1).focus.mock.calls.length).toBe(t1FocusBefore) // 迁移不抢焦点
    expect(t2FocusBefore).toBeGreaterThanOrEqual(0)
    // 外部销毁触发 state() 自愈迁移：同样不抢焦点
    const t3 = f.manager.createTab({})
    const t3FocusBefore = f.fakeOf(t3).focus.mock.calls.length
    f.fakeOf(t3).wc.destroyed = true
    f.manager.state()
    expect(f.fakeOf(t1).focus.mock.calls.length).toBe(t1FocusBefore)
    expect(t3FocusBefore).toBeGreaterThanOrEqual(0)
  })

  it('TC-T20 [失败不阻断] focus 抛错：create 不抛、激活态正常、错误经 onFocusError 上报', () => {
    const f = setup()
    f.manager.createTab({})
    const popupTab = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/x',
      partition: accountTabPartition('a1'),
    })
    f.fakeOf(popupTab).focus.mockImplementationOnce(() => {
      throw new Error('focus-fail')
    })
    const next = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/z',
      partition: accountTabPartition('a1'),
    })
    expect(() => f.manager.activateTab(popupTab)).not.toThrow()
    expect(f.manager.state().activeId).toBe(popupTab)
    expect(f.focusErrors.length).toBeGreaterThanOrEqual(1)
    expect(next).toBeGreaterThan(popupTab)
  })

  it('TC-T21 [activeWebContentsId] 返回存活 active 的 wc id；无 active → null', () => {
    const f = setup()
    const t1 = f.manager.createTab({})
    expect(f.manager.activeWebContentsId()).toBe(f.manager.webContentsIdOf(t1))
    const t2 = f.manager.createTab({})
    expect(f.manager.activeWebContentsId()).toBe(f.manager.webContentsIdOf(t2))
    f.manager.closeTab(t2)
    expect(f.manager.activeWebContentsId()).toBe(f.manager.webContentsIdOf(t1))
    f.fakeOf(t1).wc.destroyed = true
    expect(f.manager.activeWebContentsId()).toBeNull()
  })

  it('TC-T22 [后台打开不丢焦点] 打开前焦点在页面 Tab → 后台弹窗后焦点恢复到 active 页；焦点在面板时不抢', () => {
    const f = setup()
    const first = f.manager.createTab({})
    // 场景 A：打开前焦点在页面 Tab（模拟用户正在中控台页面操作）
    f.fakeOf(first).wc.focused = true
    f.fakeOf(first).focus.mockClear()
    const bg1 = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/x',
      partition: accountTabPartition('a1'),
      activate: false,
    })
    expect(f.manager.state().activeId).toBe(first) // 不抢 active
    expect(f.fakeOf(bg1).focus).not.toHaveBeenCalled()
    expect(f.fakeOf(first).focus).toHaveBeenCalledTimes(1) // 焦点还回 active 页（防丢为 null）

    // 场景 B：打开前焦点不在页面（面板/顶栏输入）→ 后台弹窗不得抢焦点
    f.fakeOf(first).wc.focused = false
    f.fakeOf(first).focus.mockClear()
    f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/y',
      partition: accountTabPartition('a1'),
      activate: false,
    })
    expect(f.fakeOf(first).focus).not.toHaveBeenCalled()
  })

  it('TC-T23 [后台延迟挂载] 后台弹窗不挂载；首次 activateTab 才挂载；未挂载关闭不 unmount', () => {
    const f = setup()
    f.manager.createTab({})
    const mountsBefore = f.mounts.length
    const bg = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/x',
      partition: accountTabPartition('a1'),
      activate: false,
    })
    const wcId = f.manager.webContentsIdOf(bg)
    expect(f.mounts.length).toBe(mountsBefore) // 后台：不挂载（防隐藏 view 丢焦点）
    f.manager.activateTab(bg)
    expect(f.mounts.filter(m => m.wcId === wcId)).toHaveLength(1) // 激活时才挂载
    // 另一个后台 Tab：未挂载直接关闭 → 不调用 unmount
    const bg2 = f.manager.createPopupTab({
      url: 'https://compass.jinritemai.com/y',
      partition: accountTabPartition('a1'),
      activate: false,
    })
    const wcId2 = f.manager.webContentsIdOf(bg2)
    f.manager.closeTab(bg2)
    expect(f.unmounts.filter(x => x === wcId2)).toHaveLength(0)
  })
})

describe('shellTabManager 排序/批量关闭/重开（TC-T24~T29）', () => {
  it('TC-T24 moveTab 只重排数组：active/mounted 不变，不触发 layout', () => {
    const f = setup()
    const a = f.manager.createTab({ url: 'https://a.example' })
    const b = f.manager.createTab({ url: 'https://b.example' })
    const c = f.manager.createTab({ url: 'https://c.example' })
    f.manager.activateTab(b)
    const layoutBefore = f.layoutCallsOf()
    const mountsBefore = f.mounts.length
    f.manager.moveTab(a, 2)
    expect(f.manager.state().tabs.map(t => t.id)).toEqual([b, c, a])
    expect(f.manager.state().activeId).toBe(b)
    expect(f.mounts.length).toBe(mountsBefore)
    expect(f.layoutCallsOf()).toBe(layoutBefore)
  })

  it('TC-T25 moveTab 越界钳制；未知 id 空操作；同位置不重复推送', () => {
    const f = setup()
    const a = f.manager.createTab({})
    const b = f.manager.createTab({})
    const c = f.manager.createTab({})
    f.manager.moveTab(a, 99)
    expect(f.manager.state().tabs.map(t => t.id)).toEqual([b, c, a])
    f.manager.moveTab(a, -5)
    expect(f.manager.state().tabs.map(t => t.id)).toEqual([a, b, c])
    const pushesBefore = f.pushes.length
    f.manager.moveTab(a, 0)
    f.manager.moveTab(999, 0)
    expect(f.pushes.length).toBe(pushesBefore)
  })

  it('TC-T26 closeBatch 关闭多个：active 迁移、索引清理、不变量保持', () => {
    const f = setup()
    const a = f.manager.createTab({})
    const b = f.manager.createTab({})
    const c = f.manager.createTab({})
    f.manager.activateTab(b)
    f.manager.closeBatch([a, c, a])
    const s = f.manager.state()
    expect(s.tabs.map(t => t.id)).toEqual([b])
    expect(s.activeId).toBe(b)
    expect(s.tabs.filter(t => t.active)).toHaveLength(1)
  })

  it('TC-T27 closeBatch 关闭全部 → 重建空白 Tab（≥1 且恰 1 active）', () => {
    const f = setup()
    const a = f.manager.createTab({})
    const b = f.manager.createTab({})
    f.manager.closeBatch([a, b])
    const s = f.manager.state()
    expect(s.tabs.length).toBe(1)
    expect(s.tabs.filter(t => t.active)).toHaveLength(1)
  })

  it('TC-T28 reopenLast：重开最近关闭的 free Tab（URL/partition 还原）', async () => {
    const f = setup()
    const id = f.manager.createTab({ url: 'https://reopen.example' })
    f.manager.closeTab(id)
    const reopened = f.manager.reopenLast()
    expect(reopened).not.toBeNull()
    await f.flush()
    const tab = f.manager.state().tabs.find(t => t.id === reopened)
    expect(tab?.url).toBe('https://reopen.example')
    expect(f.newView).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'free', partition: FREE_TAB_PARTITION }),
    )
  })

  it('TC-T29 reopenLast：账号 Tab 不入栈，空栈返回 null', () => {
    const f = setup()
    expect(f.manager.reopenLast()).toBeNull()
    const id = f.manager.createTab({ accountId: 'a1' })
    f.manager.closeTab(id)
    expect(f.manager.reopenLast()).toBeNull()
  })
})
