import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== attached 会话编排集成测试（TC-I5 ~ TC-I7，扩展 liveEnd 测试基设模式）=====
// 守护契约：
//   C-I5 attached 会话完整下播链路：事件序不变 + 断开走 teardownSession（kind=attached）
//   C-I6 混合会话隔离：断开 attached 不触碰 launched 的 browser
//   C-I7 attach 下 page.on('close') 语义保留 → page-closed 事件照发
// 前置：AccountSession.connect 需支持 { mode:'attach' }（Phase 0 TDD 红灯基线）。

const h = vi.hoisted(() => {
  const sends: Array<{ channel: string; arg: unknown }> = []
  const teardownCalls: Array<{ kind: string; accountId: string }> = []
  const emitted: Array<{ event: string; payload: unknown }> = []
  const created: WatcherPlatform[] = []

  class WatcherPlatform {
    platformName = 'fake'
    _isPerformPopup = true
    _isPerformComment = true
    _isCommentListener = true
    _isLiveStatusWatcher = true
    onLiveEnd: (() => void) | null = null
    startCalls = 0
    stopCalls = 0
    constructor() {
      created.push(this)
    }
    async connect() {
      return true
    }
    async login() {}
    async getAccountName() {
      return 'tester'
    }
    async disconnect() {}
    startLiveStatusWatch(onLiveEnd: () => void) {
      this.onLiveEnd = onLiveEnd
      this.startCalls++
    }
    stopLiveStatusWatch() {
      this.stopCalls++
    }
  }

  const task = { start: vi.fn(async () => {}), stop: vi.fn(), addStopListener: vi.fn() }

  const builtShapes: Array<ReturnType<typeof buildShape>> = []
  function buildShape(kind: 'launched' | 'attached') {
    return {
      kind,
      page: { on: vi.fn(), close: async () => {} },
      context: { storageState: async () => ({ cookies: [], origins: [] }) },
      browser: { close: async () => {} },
      // attached 壳承载体拆除钩子（真实 BrowserSession 由 createAttachedSession 提供）
      disposeShell: vi.fn(async () => {}),
    }
  }
  function makeSessionShape(kind: 'launched' | 'attached') {
    const s = buildShape(kind)
    builtShapes.push(s)
    return s
  }

  return {
    sends,
    teardownCalls,
    emitted,
    created,
    task,
    WatcherPlatform,
    makeSessionShape,
    builtShapes,
  }
})

vi.mock('electron', () => ({ Notification: vi.fn(() => ({ show: vi.fn() })) }))
vi.mock('#/windowManager', () => ({
  default: {
    send: (c: string, a?: unknown) => {
      h.sends.push({ channel: c, arg: a })
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
vi.mock('#/event/eventBus', () => ({
  emitter: {
    on: vi.fn((e: string, cb: (p: unknown) => void) => h.emitted.push({ event: e, payload: cb })),
    emit: vi.fn(),
  },
}))
vi.mock('#/platforms', () => ({ platformFactory: { dev: h.WatcherPlatform } }))
vi.mock('#/tasks/AutoPopupTask', async () => {
  const { Result } = await import('@praha/byethrow')
  return { createAutoPopupTask: () => Result.succeed(h.task) }
})

// 关键 mock：teardownSession 记录 kind；browserManager 双工厂
vi.mock('#/driver/types', () => ({
  teardownSession: vi.fn(async (s: { kind: string }) => {
    h.teardownCalls.push({ kind: s.kind, accountId: 'recorded' })
  }),
}))
vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: {
    createSession: async () => h.makeSessionShape('launched'),
    createAttachedSession: async () => h.makeSessionShape('attached'),
  },
}))

import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AccountSession } from '../AccountSession'

const C = IPC_CHANNELS.tasks.liveControl

async function setupAttached(accountId = 'a1') {
  const session = new AccountSession('dev', { id: accountId, name: '主播A' } as Account)
  await session.connect({ mode: 'attach' } as never)
  return session
}

beforeEach(() => {
  h.sends.length = 0
  h.teardownCalls.length = 0
  h.emitted.length = 0
  h.created.length = 0
  h.builtShapes.length = 0
  h.task.start.mockClear()
  h.task.stop.mockClear()
})

describe('attached 会话编排（TC-I5 ~ TC-I8）', () => {
  it('TC-I5 [下播链路去破坏化] attached：停任务 + 一次 liveEndedEvent，不拆会话/Tab、不走 teardown', async () => {
    const session = await setupAttached()
    const platform = h.created[0]
    const disconnectSpy = vi.spyOn(session, 'disconnect')
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.sends.length = 0

    platform.onLiveEnd!()

    expect(h.sends.filter(s => s.channel === C.liveEndedEvent)).toHaveLength(1)
    expect(h.task.stop).toHaveBeenCalledTimes(1)
    expect(platform.stopCalls).toBe(1)
    // 核心契约（fix-shell-popup-navigation-liveend A3）：下播只停任务，会话与壳内 Tab 保留
    expect(disconnectSpy).not.toHaveBeenCalled()
    expect(h.sends.filter(s => s.channel === C.disconnectedEvent)).toHaveLength(0)
    expect(h.teardownCalls).toHaveLength(0)
    // 壳承载体（Tab/pageView）也不能被拆：只有手动 disconnect 才 disposeShell
    expect(h.builtShapes.at(-1)!.disposeShell).not.toHaveBeenCalled()
  })

  it('TC-I6 [混合隔离] 断开 attached 会话，teardown 入参 kind=attached（launched 会话不受波及）', async () => {
    const attached = await setupAttached('acc-attach')
    await setupAttached('acc-attach2')
    h.teardownCalls.length = 0

    attached.disconnect()

    expect(h.teardownCalls).toHaveLength(1)
    expect(h.teardownCalls[0].kind).toBe('attached')
  })

  it('TC-I7 [close 语义] attached 连接后注册 page.on("close")', async () => {
    await setupAttached()
    const shape = h.builtShapes.at(-1)!
    expect(shape.page.on).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('TC-I8 [会话保留后可手动断开] 下播后 disconnect 照旧走 teardownSession 并通知渲染层', async () => {
    const session = await setupAttached()
    const platform = h.created[0]
    const shape = h.builtShapes.at(-1)!
    platform.onLiveEnd!()
    h.sends.length = 0

    session.disconnect()

    expect(h.teardownCalls).toHaveLength(1)
    expect(h.teardownCalls[0].kind).toBe('attached')
    expect(h.sends.filter(s => s.channel === C.disconnectedEvent)).toHaveLength(1)
    // disposeShell 是 attached 的壳拆除钩子（单窗口=移除 pageView / 窗口模式=关窗）：
    // 手动断开才拆，下播链路（上一步）不得触碰它
    expect(shape.disposeShell).toHaveBeenCalledTimes(1)
  })
})
