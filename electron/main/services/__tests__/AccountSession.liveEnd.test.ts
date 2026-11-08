import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 测试基础设施 =====
// AccountSession 直播结束编排链路集成测试：
// fake platform（含/不含 ILiveStatusWatcher 能力）+ fake browser session +
// fake task 工厂 + 记录 windowManager.send 顺序，验证重入守卫、事件顺序、断开联动。
//
// 契约变更（fix-shell-popup-navigation-liveend A3 · 下播去破坏化）：
//   下播信号 = 只停任务 + 通知；**不再 disconnect()**（会话/壳内 Tab 保留，用户手动断开）。
//   误判不可逆的根因即「停止任务」与「拆除会话」耦合，本文件守住「会话保留」这条线。

const h = vi.hoisted(() => {
  const sends: Array<{ channel: string; arg: unknown }> = []
  const notifications: Array<{ title: string; body: string }> = []
  const browserCloseCalls = { n: 0 }
  const created: WatcherPlatform[] = []

  class FakePlatformBase {
    platformName = 'fake'
    _isPerformPopup = true
    _isPerformComment = true
    _isCommentListener = true
    onLiveEnd: (() => void) | null = null
    startCalls = 0
    stopCalls = 0
    async connect() {
      return true
    }
    async login() {}
    async getAccountName() {
      return 'tester'
    }
    async disconnect() {}
  }

  /** 具备直播状态监听能力（抖音系/dev） */
  class WatcherPlatform extends FakePlatformBase {
    readonly _isLiveStatusWatcher = true
    constructor() {
      super()
      created.push(this)
    }
    startLiveStatusWatch(onLiveEnd: () => void) {
      this.onLiveEnd = onLiveEnd
      this.startCalls++
    }
    stopLiveStatusWatch() {
      this.stopCalls++
    }
  }

  /** 无该能力的平台（淘宝/快手等） */
  class PlainPlatform extends FakePlatformBase {}

  const task = {
    start: vi.fn(async () => {}),
    // 推进 sends 以便断言「先通知再停任务」的顺序契约
    stop: vi.fn(() => {
      sends.push({ channel: '__task-stop', arg: undefined })
    }),
    addStopListener: vi.fn(),
  }
  const NotificationMock = vi.fn(function (this: unknown, opts: { title: string; body: string }) {
    notifications.push(opts)
    return { show: vi.fn() }
  })

  return {
    sends,
    notifications,
    browserCloseCalls,
    created,
    task,
    NotificationMock,
    WatcherPlatform,
    PlainPlatform,
  }
})

vi.mock('electron', () => ({ Notification: h.NotificationMock }))

vi.mock('#/windowManager', () => ({
  default: {
    send: (channel: string, arg?: unknown) => {
      h.sends.push({ channel, arg })
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
    createSession: async () => ({
      kind: 'launched',
      page: { on: vi.fn(), close: async () => {} },
      context: { storageState: async () => ({ cookies: [], origins: [] }) },
      browser: {
        close: async () => {
          h.browserCloseCalls.n++
        },
      },
    }),
  },
}))

vi.mock('#/platforms', () => ({
  platformFactory: { dev: h.WatcherPlatform, taobao: h.PlainPlatform },
}))

vi.mock('#/event/eventBus', () => ({ emitter: { on: vi.fn(), emit: vi.fn() } }))

// 任务工厂：返回统一的 fake ITask（makeTask 的类型守卫由 fake platform 标志满足）
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

const C = IPC_CHANNELS.tasks.liveControl

async function setupSession(platformName: 'dev' | 'taobao') {
  const session = new AccountSession(platformName, { id: 'a1', name: '主播A' } as Account)
  await session.connect({ headless: true })
  return session
}

const taskStopMarkers = () => h.sends.filter(s => s.channel === '__task-stop')

beforeEach(() => {
  h.sends.length = 0
  h.notifications.length = 0
  h.created.length = 0
  h.browserCloseCalls.n = 0
  h.task.start.mockClear()
  h.task.stop.mockClear()
  h.NotificationMock.mockClear()
})

describe('AccountSession 直播结束编排（TC-I1 ~ TC-I4）', () => {
  it('TC-I1 [重入守卫 + 去破坏化] onLiveEnd 重复触发：停任务/事件/通知/watcher 停止各一次，且不拆除会话', async () => {
    const session = await setupSession('dev')
    const platform = h.created[0]
    const disconnectSpy = vi.spyOn(session, 'disconnect')
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.sends.length = 0 // 只观察结束链路

    platform.onLiveEnd!()
    platform.onLiveEnd!() // 双信号/竞态重复触发

    expect(h.task.stop).toHaveBeenCalledTimes(1)
    expect(h.sends.filter(s => s.channel === C.liveEndedEvent)).toHaveLength(1)
    expect(h.notifications).toHaveLength(1)
    // watcher 由 handleLiveEnded 自己停掉（不再依赖 disconnect），重复信号不得二次进入
    expect(platform.stopCalls).toBe(1)
    // 核心契约：下播不再拆会话——不 disconnect、不 teardown（browser.close 不调用）
    expect(disconnectSpy).not.toHaveBeenCalled()
    expect(h.sends.filter(s => s.channel === C.disconnectedEvent)).toHaveLength(0)
    expect(h.browserCloseCalls.n).toBe(0)
  })

  it('TC-I2 [顺序契约] 先发 liveEndedEvent 通知渲染层，再停止任务（用户先看到原因）', async () => {
    const session = await setupSession('dev')
    const platform = h.created[0]
    await session.startTask({ type: 'auto-popup', config: {} } as LiveControlTask)
    h.sends.length = 0

    platform.onLiveEnd!()

    const endedIdx = h.sends.findIndex(s => s.channel === C.liveEndedEvent)
    expect(endedIdx).toBeGreaterThanOrEqual(0)
    expect(h.sends[endedIdx].arg).toBe('a1')
    expect(taskStopMarkers()).toHaveLength(1)
    const stopIdx = h.sends.findIndex(s => s.channel === '__task-stop')
    expect(stopIdx).toBeGreaterThan(endedIdx)
    // 不再有「已断开」事件：会话与 Tab 保留
    expect(h.sends.some(s => s.channel === C.disconnectedEvent)).toBe(false)
  })

  it('TC-I3 [能力守卫] 无 ILiveStatusWatcher 能力的平台不启动监听、连接正常', async () => {
    const session = await setupSession('taobao')
    // PlainPlatform 无 watcher：connect 成功且不注册任何监听
    expect(session).toBeTruthy()
    const plain = h.created.find(p => !('_isLiveStatusWatcher' in p))
    expect(plain).toBeUndefined() // PlainPlatform 不进入 created（仅 WatcherPlatform 记录）
    expect(h.created).toHaveLength(0)
  })

  it('TC-I4 [手动断开] disconnect 照旧停止 watcher，迟到的 onLiveEnd 不再触发任何动作', async () => {
    const session = await setupSession('dev')
    const platform = h.created[0]
    expect(platform.startCalls).toBe(1)

    session.disconnect()
    expect(platform.stopCalls).toBe(1)
    h.sends.length = 0
    h.browserCloseCalls.n = 0

    platform.onLiveEnd!() // watcher 已停，但若有竞态迟到回调
    expect(h.sends).toHaveLength(0)
    expect(h.browserCloseCalls.n).toBe(0)
    expect(h.task.stop).not.toHaveBeenCalled()
  })

  it('TC-I4b [会话保留后可手动断开] 下播链路结束后 disconnect 仍完整拆除（teardown 一次 + 断开事件）', async () => {
    const session = await setupSession('dev')
    const platform = h.created[0]
    platform.onLiveEnd!()
    h.sends.length = 0

    session.disconnect()

    expect(h.browserCloseCalls.n).toBe(1) // launched：teardownSession → browser.close 一次
    expect(platform.stopCalls).toBe(2) // 下播停一次 + 手动断开停一次
    expect(h.sends.filter(s => s.channel === C.disconnectedEvent)).toHaveLength(1)
  })

  it('重连复位：disconnect 后再次 connect 恢复监听能力（liveEndedHandled 复位）', async () => {
    const session = await setupSession('dev')
    const platform = h.created[0]
    session.disconnect()
    await session.connect({ headless: true })
    h.sends.length = 0

    platform.onLiveEnd!() // 新会话的下播应正常触发
    expect(h.sends.some(s => s.channel === C.liveEndedEvent)).toBe(true)
  })
})
