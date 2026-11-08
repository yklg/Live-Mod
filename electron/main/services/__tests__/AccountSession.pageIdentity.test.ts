import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 会话层「弹窗语义生命周期」+「会话页身份观测」集成测试 =====
// 覆盖 fix-shell-popup-navigation-liveend A2/P0 契约：
// 1) popupMode：attach 建会话后= 'navigate'（登录窗口期旧语义）→ ensureAuthenticated 完成= null
//    （浏览器语义）；launched 会话不提供该方法；
// 2) framenavigated：仅主 frame；page 被替换后重新绑定；离开中控台且任务运行中 → 每段只发一次
//    shell.warnToast；回控制页复位；平台未实现 isControlPageUrl → 不观测、不抛错。

const h = vi.hoisted(() => {
  type PopupMode = 'navigate' | null
  type FakeFrame = { parentFrame: () => unknown; url: () => string }
  type FakePage = {
    on: ReturnType<typeof vi.fn>
    url: () => string
    close: () => Promise<void>
  }
  type FakeSession = {
    kind: 'launched' | 'attached'
    page: FakePage
    context: { storageState: () => Promise<{ cookies: never[]; origins: never[] }> }
    browser: { close: () => Promise<void> }
    accountId?: string
    disposeShell?: () => Promise<void>
    setPopupMode?: (mode: PopupMode) => void
  }
  type NavBinding = {
    page: FakePage
    handler: (frame: FakeFrame) => void
  }

  const sends: Array<{ channel: string; arg: unknown }> = []
  const toasts: Array<{ channel: string; message: string }> = []
  const popupModes: PopupMode[] = []
  const popupModeSnapshots: PopupMode[][] = []
  const pages: FakePage[] = []
  const sessions: FakeSession[] = []
  const navBindings: NavBinding[] = []
  const created: FakePlatformBase[] = []

  function makeFrame(url: string, parent: unknown = null): FakeFrame {
    return { parentFrame: () => parent, url: () => url }
  }

  function makePage(): FakePage {
    const page: FakePage = { on: vi.fn(), url: () => 'about:blank', close: async () => {} }
    page.on.mockImplementation((event: string, fn: (frame: FakeFrame) => void) => {
      if (event === 'framenavigated') navBindings.push({ page, handler: fn })
    })
    pages.push(page)
    return page
  }

  function makeSession(kind: 'launched' | 'attached'): FakeSession {
    const session: FakeSession = {
      kind,
      page: makePage(),
      context: { storageState: async () => ({ cookies: [], origins: [] }) },
      browser: { close: async () => {} },
    }
    if (kind === 'attached') {
      session.accountId = 'a1'
      session.disposeShell = async () => {}
      session.setPopupMode = mode => popupModes.push(mode)
    }
    sessions.push(session)
    return session
  }

  /** 当前会话页对应的最后一个 framenavigated 绑定（page 被替换后应指向新页） */
  function bindingOfCurrentPage(): NavBinding {
    const page = sessions.at(-1)?.page
    const bound = navBindings.filter(b => b.page === page).at(-1)
    if (!bound) throw new Error('当前会话页未绑定 framenavigated')
    return bound
  }

  /** 向当前会话页派发一次主 frame 导航（parent=非 null 可模拟 iframe 导航） */
  function emitNav(url: string, parent: unknown = null) {
    bindingOfCurrentPage().handler(makeFrame(url, parent))
  }

  class FakePlatformBase {
    platformName = 'fake'
    _isPerformPopup = true
    _isPerformComment = true
    _isCommentListener = true
    onLiveEnd: (() => void) | null = null
    connectCalls = 0
    requireLogin = false
    constructor() {
      created.push(this)
    }
    async connect() {
      this.connectCalls++
      // 记录「平台 connect 时」的弹窗意图：登录窗口期语义必须在平台链路开始前已声明
      popupModeSnapshots.push([...popupModes])
      return !(this.requireLogin && this.connectCalls === 1)
    }
    async login(_session: FakeSession) {}
    async getAccountName() {
      return 'tester'
    }
    async disconnect() {}
    startLiveStatusWatch(_onLiveEnd: () => void) {}
    stopLiveStatusWatch() {}
  }

  /** 实现了控制页判据的平台（抖音/百应/eos 同契约） */
  class ControlPlatform extends FakePlatformBase {
    isControlPageUrl(url: string) {
      return url.startsWith('https://control.example.com/')
    }
  }

  /** 登录链路会替换会话页（模拟平台 login 内 browserSession.page = newPage） */
  class LoginReplacingPlatform extends ControlPlatform {
    override async login(session: FakeSession) {
      session.page = makePage()
    }
  }

  /** 控制页判据本身抛错的平台（URL 畸形/实现缺陷）：会话层必须静默容错 */
  class ThrowingPlatform extends FakePlatformBase {
    isControlPageUrl(): boolean {
      throw new Error('boom')
    }
  }

  /** 未实现 isControlPageUrl 的旧平台：不观测、行为与改造前一致 */
  class PlainPlatform extends FakePlatformBase {}

  const task = { start: vi.fn(async () => {}), stop: vi.fn(), addStopListener: vi.fn() }

  return {
    sends,
    toasts,
    popupModes,
    popupModeSnapshots,
    pages,
    sessions,
    navBindings,
    created,
    task,
    makeSession,
    makeFrame,
    emitNav,
    bindingOfCurrentPage,
    FakePlatformBase,
    ControlPlatform,
    LoginReplacingPlatform,
    ThrowingPlatform,
    PlainPlatform,
  }
})

vi.mock('electron', () => ({ Notification: vi.fn(() => ({ show: vi.fn() })) }))

vi.mock('#/windowManager', () => ({
  default: {
    send: (channel: string, arg?: unknown) => {
      h.sends.push({ channel, arg })
      return true
    },
    sendTo: (target: string, channel: string, ...args: unknown[]) => {
      // 只记录告警 toast（'ui' 目标 = 业务树/railView）；保留通道以便断言确实走 shell.warnToast
      if (target === 'ui' && args[0]) h.toasts.push({ channel, message: String(args[0]) })
      return true
    },
  },
}))

vi.mock('#/logger', () => {
  const stub = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    scope: () => stub,
  }
  return { createLogger: () => stub }
})

vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: {
    createSession: async () => h.makeSession('launched'),
    createAttachedSession: async () => h.makeSession('attached'),
  },
}))

vi.mock('#/platforms', () => ({
  platformFactory: {
    douyin: h.ControlPlatform,
    buyin: h.LoginReplacingPlatform,
    dev: h.ThrowingPlatform,
    taobao: h.PlainPlatform,
  },
}))

vi.mock('#/event/eventBus', () => ({ emitter: { on: vi.fn(), emit: vi.fn() } }))

// 任务工厂全部 mock：本文件只关心「任务是否在跑」这一状态，任务实现无关
vi.mock('#/tasks/AutoPopupTask', async () => {
  const { Result } = await import('@praha/byethrow')
  return { createAutoPopupTask: () => Result.succeed(h.task) }
})
vi.mock('#/tasks/AutoCommentTask', async () => {
  const { Result } = await import('@praha/byethrow')
  return { createAutoCommentTask: () => Result.succeed(h.task) }
})
vi.mock('#/tasks/CommentListenerTask', async () => {
  const { Result } = await import('@praha/byethrow')
  return { createCommentListenerTask: () => Result.succeed(h.task) }
})
vi.mock('#/tasks/PinCommentTask', async () => {
  const { Result } = await import('@praha/byethrow')
  return { createPinCommentTask: () => Result.succeed(h.task) }
})
vi.mock('#/tasks/SendBatchMessageTask', async () => {
  const { Result } = await import('@praha/byethrow')
  return { createSendBatchMessageTask: () => Result.succeed(h.task) }
})

import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AccountSession } from '../AccountSession'

const CONTROL_URL = 'https://control.example.com/ffa/content-tool/live/control'
const ELSEWHERE_URL = 'https://compass.example.com/business_api/home/dd_redirect/25101'
const LEAVE_TOAST = '中控台页面已离开，任务可能失效'

/** 仅断言经 shell.warnToast 通道发出的提示（避免把其它 ui 推送混进来） */
const warnToasts = () =>
  h.toasts.filter(t => t.channel === IPC_CHANNELS.shell.warnToast).map(t => t.message)

async function setupSession(
  platformName: LiveControlPlatform,
  mode: 'attach' | 'launch' = 'attach',
) {
  const session = new AccountSession(platformName, { id: 'a1', name: '主播A' } as Account)
  await session.connect(mode === 'attach' ? ({ mode: 'attach' } as never) : { headless: true })
  return session
}

beforeEach(() => {
  h.sends.length = 0
  h.toasts.length = 0
  h.popupModes.length = 0
  h.popupModeSnapshots.length = 0
  h.pages.length = 0
  h.sessions.length = 0
  h.navBindings.length = 0
  h.created.length = 0
  h.task.start.mockClear()
  h.task.stop.mockClear()
})

describe('弹窗语义生命周期（popupMode）', () => {
  it('TC-PM1 attach：平台链路开始前已声明 navigate，认证完成后复位 null（浏览器语义）', async () => {
    await setupSession('douyin')

    // 平台 connect 被调用时（登录窗口期开始）意图必须是 'navigate'
    expect(h.popupModeSnapshots[0]).toEqual(['navigate'])
    // 认证结束 → 复位为浏览器语义（壳内新 Tab）
    expect(h.popupModes).toEqual(['navigate', null])
  })

  it('TC-PM2 attach + 需登录：page 被登录链路替换后仍复位 null，且观测重绑到新会话页', async () => {
    const session = new AccountSession('buyin', { id: 'a1', name: '主播A' } as Account)
    // 第一次 platform.connect 返回 false → 走 attach 登录分支；login 内替换会话页
    h.created[0].requireLogin = true
    await session.connect({ mode: 'attach' } as never)

    expect(h.popupModes).toEqual(['navigate', null])
    expect(h.pages).toHaveLength(2) // 初始页 + 登录替换页
    // 观测已重绑到最终会话页（WeakSet 幂等不会重复绑定同一页）
    expect(h.bindingOfCurrentPage().page).toBe(h.sessions.at(-1)!.page)

    // 任务运行中：旧页导航不再代表会话身份（静默），新页离开控制页才告警
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    const oldBinding = h.navBindings.find(b => b.page !== h.sessions.at(-1)!.page)!
    oldBinding.handler(h.makeFrame(ELSEWHERE_URL))
    expect(h.toasts).toHaveLength(0)
    h.emitNav(ELSEWHERE_URL)
    expect(warnToasts()).toEqual([LEAVE_TOAST])
  })

  it('TC-PM3 launched 会话不提供 setPopupMode：连接正常、零调用', async () => {
    const session = await setupSession('taobao', 'launch')
    expect(session).toBeTruthy()
    expect(h.popupModes).toHaveLength(0)
  })
})

describe('会话页身份观测（framenavigated → warnToast）', () => {
  it('TC-N1 离开控制页：任务运行中每段只告警一次；回控制页复位后可再次告警', async () => {
    const session = await setupSession('douyin')
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.toasts.length = 0

    h.emitNav(ELSEWHERE_URL)
    expect(h.toasts).toHaveLength(1)
    h.emitNav('https://compass.example.com/other') // 同段连续导航：不重复打扰
    expect(h.toasts).toHaveLength(1)

    h.emitNav(CONTROL_URL) // 回到中控台：告警闸复位
    h.emitNav(ELSEWHERE_URL) // 新一段离开：再次告警
    expect(h.toasts).toHaveLength(2)
  })

  it('TC-N2 无任务时离开静默；任务启动时发现页面已离开 → 立即提示一次（同段不重复）', async () => {
    const session = await setupSession('douyin')
    h.emitNav(ELSEWHERE_URL)
    expect(warnToasts()).toHaveLength(0) // 没有任务在跑：页面漂移无损失，不打扰

    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    expect(warnToasts()).toEqual([LEAVE_TOAST]) // 启动即发现不在中控台：立即提示

    h.emitNav(ELSEWHERE_URL) // 同段再次离开：不重复提示
    expect(warnToasts()).toHaveLength(1)
  })

  it('TC-N3 仅观测主 frame：iframe 导航不改变会话页身份', async () => {
    const session = await setupSession('douyin')
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.toasts.length = 0

    h.emitNav(ELSEWHERE_URL, { parent: 'iframe' }) // 非主 frame
    expect(h.toasts).toHaveLength(0)
  })

  it('TC-N4 平台未实现 isControlPageUrl：不观测、不抛错（旧平台零行为变化）', async () => {
    await setupSession('taobao')
    // 只注册 page.on('close')，不注册 framenavigated
    expect(h.navBindings).toHaveLength(0)
    expect(h.sessions.at(-1)!.page.on).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('TC-N5 平台判定抛错/URL 畸形：静默跳过，不影响主流程', async () => {
    const session = await setupSession('dev')
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.toasts.length = 0

    expect(() => h.emitNav('about:blank')).not.toThrow()
    expect(h.toasts).toHaveLength(0)
  })

  it('TC-N6 告警文案走 shell.warnToast 通道（ui 目标）；不触发下播链路', async () => {
    const session = await setupSession('douyin')
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.emitNav(ELSEWHERE_URL)

    expect(IPC_CHANNELS.shell.warnToast).toBe('shell:warnToast')
    expect(warnToasts()).toEqual([LEAVE_TOAST])
    expect(h.sends.some(s => s.channel === IPC_CHANNELS.tasks.liveControl.liveEndedEvent)).toBe(
      false,
    )
    expect(session.hasActiveTasks()).toBe(true) // 页面漂移只告警，不停任务（停任务由下播链路负责）
  })
})
