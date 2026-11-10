import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 连接中止判别式（壳 v3 · Wave 1 · P0-1 · CV-U01~CV-U04）=====
// 守护契约：
//   CV-U01 abort() 之后 catch 走 aborted 分支 → 抛 ConnectionAbortedError
//   CV-U02 **未** abort 时错误原样冒泡（不被包装成 ConnectionAbortedError）
//   CV-U03 abort 与抛错并发时，以 signal.aborted 为准（不依赖布尔时序）
//   CV-U04 竞态前置守卫：制造前显式断言"还没中止"，否则用例恒假
//
// 为什么必须测这一层：旧实现把"页面被拆 → 等待中的选择器抛 Target page has been closed"
// 当成 attach 失败，于是降级回退外部浏览器。判别式就在这一层，测它才测得到根因。
//
// 时序说明（对齐真实链路）：页面被拆时，`page.on('close')` → emitter → closeSession →
// disconnect() → abort() 是**同步**发生的；等待中的选择器则在之后才以
// "Target page has been closed" 抛错。所以用例里必须先 abort、再让闸门失败。

const h = vi.hoisted(() => {
  const teardownCalls: Array<{ kind: string }> = []
  const sends: Array<{ channel: string }> = []

  /** 闸门：控制"等待中的操作"何时结束（放行 → 继续；失败 → 直接抛） */
  let gate: { promise: Promise<void>; release: () => void; fail: (e: unknown) => void } | null = null
  function openGate() {
    let release!: () => void
    let fail!: (e: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve
      fail = reject
    })
    gate = { promise, release, fail }
    return gate
  }

  class GatePlatform {
    platformName = 'dev'
    _isPerformPopup = true
    _isPerformComment = true
    _isCommentListener = true
    _isLiveStatusWatcher = true
    /** 由用例设置：connect 的行为 */
    onConnect: (session: unknown) => Promise<boolean> = async () => true
    async connect(session: unknown) {
      return this.onConnect(session)
    }
    async login() {}
    async getAccountName() {
      return 'tester'
    }
    async disconnect() {}
    startLiveStatusWatch() {}
    stopLiveStatusWatch() {}
  }

  function makeSessionShape() {
    return {
      kind: 'launched' as const,
      page: { on: vi.fn(), close: async () => {} },
      context: { storageState: async () => ({ cookies: [], origins: [] }) },
      browser: { close: async () => {} },
    }
  }

  return {
    teardownCalls,
    sends,
    openGate,
    get gate() {
      return gate
    },
    GatePlatform,
    makeSessionShape,
  }
})

vi.mock('electron', () => ({ Notification: vi.fn(() => ({ show: vi.fn() })) }))
vi.mock('#/windowManager', () => ({
  default: {
    send: (c: string) => {
      h.sends.push({ channel: c })
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
  emitter: { on: vi.fn(), emit: vi.fn() },
}))
vi.mock('#/platforms', () => ({ platformFactory: { dev: h.GatePlatform } }))
vi.mock('#/driver/types', () => ({
  teardownSession: vi.fn(async (s: { kind: string }) => {
    h.teardownCalls.push({ kind: s.kind })
  }),
}))
vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: { createSession: async () => h.makeSessionShape() },
}))
vi.mock('#/services/commentBackend/registry', () => ({
  commentBackendRegistry: { stop: vi.fn(async () => {}) },
}))

import { ConnectionAbortedError } from '#/errors/ConnectionAbortedError'
import { AccountSession } from '../AccountSession'

const account = { id: 'acc-1', name: '主播A' } as Account

/** 让出若干微任务，确保 connect() 已经走到平台的 connect() 里 */
const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

function newSession() {
  return new AccountSession('dev', account)
}

function platformOf(session: AccountSession) {
  return (session as unknown as { platform: h.GatePlatform }).platform
}

beforeEach(() => {
  h.teardownCalls.length = 0
  h.sends.length = 0
})

describe('连接中止判别式（CV-U01~CV-U04）', () => {
  it('CV-U01 abort 之后 → 抛 ConnectionAbortedError（带 connectId 与关闭来源）', async () => {
    const session = newSession()
    const g = h.openGate()
    platformOf(session).onConnect = async () => {
      await g.promise
      return true
    }

    const pending = session.connect({ mode: 'launch' } as never)
    await tick()
    // 页面被拆：abort 同步置位
    session.disconnect('user')
    // 等待中的操作随后以"页面已关闭"失败
    g.fail(new Error('Target page has been closed'))

    await expect(pending).rejects.toBeInstanceOf(ConnectionAbortedError)
    await pending.catch((e: ConnectionAbortedError) => {
      expect(e.kind).toBe('aborted')
      expect(e.closeReason).toBe('user')
      expect(e.connectId).toContain('acc-1')
    })
  })

  it('CV-U01b 关闭来源为 page-closed → kind=page-closed（与 aborted 不混淆）', async () => {
    const session = newSession()
    const g = h.openGate()
    platformOf(session).onConnect = async () => {
      await g.promise
      return true
    }

    const pending = session.connect({ mode: 'launch' } as never)
    await tick()
    session.disconnect('page-closed')
    g.fail(new Error('Target page has been closed'))

    await expect(pending).rejects.toBeInstanceOf(ConnectionAbortedError)
    await pending.catch((e: ConnectionAbortedError) => {
      expect(e.kind).toBe('page-closed')
      expect(e.closeReason).toBe('page-closed')
    })
  })

  it('CV-U02 未 abort 时错误**原样冒泡**（不被包装成 ConnectionAbortedError）', async () => {
    const session = newSession()
    const original = new Error('CDP endpoint 不可用')
    platformOf(session).onConnect = async () => {
      throw original
    }

    await expect(session.connect({ mode: 'launch' } as never)).rejects.toBe(original)
    await session.connect({ mode: 'launch' } as never).catch((e: unknown) => {
      expect(e).not.toBeInstanceOf(ConnectionAbortedError)
    })
  })

  it('CV-U03 abort 与抛错在同一轮发生 → 仍以 signal.aborted 为准（归约为中止）', async () => {
    const session = newSession()
    const g = h.openGate()
    // 平台在失败的那一刻同步触发 disconnect（真实链路：page.on('close') → closeSession → abort）
    platformOf(session).onConnect = async () => {
      await g.promise
      session.disconnect('user')
      throw new Error('Target page has been closed')
    }

    const pending = session.connect({ mode: 'launch' } as never)
    await tick()
    // 放行：平台在同一轮里先断开（abort 同步置位），再抛错
    g.release()

    await expect(pending).rejects.toBeInstanceOf(ConnectionAbortedError)
    await pending.catch((e: ConnectionAbortedError) => {
      expect(e.kind).toBe('aborted')
      // 原始错误保留在 cause 里，便于事后定位
      expect((e.cause as Error).message).toBe('Target page has been closed')
    })
  })

  it('CV-U04 竞态前置守卫：制造前确认尚未结束，制造后确实成立', async () => {
    const session = newSession()
    const g = h.openGate()
    let settled = false
    platformOf(session).onConnect = async () => {
      await g.promise
      return true
    }

    const pending = session.connect({ mode: 'launch' } as never)
    pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await tick()

    // 前置：此刻还没结束（否则本用例恒假，测不出东西）
    expect(settled).toBe(false)

    session.disconnect('user')
    g.fail(new Error('Target page has been closed'))
    await expect(pending).rejects.toBeInstanceOf(ConnectionAbortedError)

    // 后置：制造确实成立
    expect(settled).toBe(true)
  })

  it('CV-U04b 重连会中止上一轮连接：上一轮归因 aborted，新一轮的错误原样冒泡', async () => {
    const session = newSession()
    const g = h.openGate()
    platformOf(session).onConnect = async () => {
      await g.promise
      return true
    }

    const first = session.connect({ mode: 'launch' } as never)
    await tick()
    // 重连：新 connect 会先 abort 上一轮
    const second = session.connect({ mode: 'launch' } as never)
    await tick()

    const raw = new Error('第二轮的原始错误')
    g.fail(raw)

    await expect(first).rejects.toBeInstanceOf(ConnectionAbortedError)
    await first.catch((e: ConnectionAbortedError) => {
      expect(e.kind).toBe('aborted')
    })
    // 新一轮没有被中止 → 原样冒泡
    await expect(second).rejects.toBe(raw)
  })
})
