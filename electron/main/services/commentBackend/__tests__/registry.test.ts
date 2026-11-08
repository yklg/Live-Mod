import { describe, expect, it, vi } from 'vitest'

// 单测环境无 Electron app：registry 默认工厂会 import 真实 backend（其 logger 依赖 electron.app）→ 打桩
vi.mock('#/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    scope: () => ({ info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() }),
  }),
}))

import type { CommentBackendLike, CommentBackendStatus } from '#/services/commentBackend/contracts'
import { CommentBackendRegistry } from '#/services/commentBackend/registry'

function fakeBackend(status: CommentBackendStatus = { state: 'live', comments: 0 }) {
  const start = vi.fn(async () => status)
  const stop = vi.fn(async () => {})
  const backend: CommentBackendLike = { start, stop, getStatus: () => status }
  return { backend, start, stop }
}

describe('CommentBackendRegistry（TC-CB10~CB13）', () => {
  it('TC-CB10 ensure 同账号幂等：不重复创建/启动', async () => {
    const { backend, start } = fakeBackend()
    const factory = vi.fn(() => backend)
    const registry = new CommentBackendRegistry(factory)
    const deps = {
      consoleUrl: 'https://a.example',
      getState: async () => ({ cookies: [], localStorage: {} }),
      createSession: async () => {
        throw new Error('noop')
      },
    }
    await registry.ensure('acc1', deps)
    await registry.ensure('acc1', deps)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('TC-CB11 多账号隔离与上限（超上限抛错）', async () => {
    const factory = vi.fn(() => fakeBackend().backend)
    const registry = new CommentBackendRegistry(factory, 2)
    const deps = {
      consoleUrl: 'https://a.example',
      getState: async () => ({ cookies: [], localStorage: {} }),
      createSession: async () => {
        throw new Error('noop')
      },
    }
    await registry.ensure('acc1', deps)
    await registry.ensure('acc2', deps)
    await expect(registry.ensure('acc3', deps)).rejects.toThrow('上限')
    expect(registry.size).toBe(2)
  })

  it('TC-CB12 stop 移除并调用后端 stop；list 快照反映状态', async () => {
    const { backend, stop } = fakeBackend()
    const registry = new CommentBackendRegistry(() => backend)
    const deps = {
      consoleUrl: 'https://a.example',
      getState: async () => ({ cookies: [], localStorage: {} }),
      createSession: async () => {
        throw new Error('noop')
      },
    }
    await registry.ensure('acc1', deps)
    expect(registry.list()).toEqual([{ accountId: 'acc1', status: { state: 'live', comments: 0 } }])
    await registry.stop('acc1')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(registry.list()).toEqual([])
  })

  it('TC-CB13 启动 error 的账号不驻留（允许后续重试）', async () => {
    const { backend } = fakeBackend({ state: 'error', comments: 0, error: 'boom' })
    const registry = new CommentBackendRegistry(() => backend)
    const deps = {
      consoleUrl: 'https://a.example',
      getState: async () => ({ cookies: [], localStorage: {} }),
      createSession: async () => {
        throw new Error('noop')
      },
    }
    const status = await registry.ensure('acc1', deps)
    expect(status.state).toBe('error')
    expect(registry.list()).toEqual([])
  })
})

// ===== 采集进程死亡后必须重建（实测故障：headless Chrome 被系统杀掉后进程静默消失，
// 旧实例留在表里 → ensure 一直返回它 → 面板永远 0 条且无任何线索）=====
describe('CommentBackendRegistry 死亡重建（TC-CB17）', () => {
  it('TC-CB17 后端进程已死 → ensure 丢弃旧实例并重建（不再复用死实例）', async () => {
    let alive = true
    const deadStop = vi.fn(async () => {})
    const dead = {
      start: vi.fn(async () => ({ state: 'live' as const, comments: 0 })),
      stop: deadStop,
      getStatus: () => ({ state: 'live' as const, comments: 0 }),
      isAlive: () => alive,
    }
    const fresh = fakeBackend()
    const factory = vi.fn(() => (alive ? dead : fresh.backend))
    const registry = new CommentBackendRegistry(factory)
    const deps = {
      consoleUrl: 'https://a.example',
      getState: async () => ({ cookies: [], localStorage: {} }),
      createSession: async () => {
        throw new Error('noop')
      },
    }

    await registry.ensure('acc1', deps)
    expect(factory).toHaveBeenCalledTimes(1)

    // 进程被杀 → 再次 ensure 必须重建，而不是复用死实例
    alive = false
    await registry.ensure('acc1', deps)

    expect(factory).toHaveBeenCalledTimes(2)
    expect(deadStop).toHaveBeenCalledTimes(1)
    expect(registry.list().map(x => x.accountId)).toEqual(['acc1'])
  })

  it('TC-CB17b 存活的后端仍然幂等复用（不误重建）', async () => {
    const { backend, start } = fakeBackend()
    backend.isAlive = () => true
    const factory = vi.fn(() => backend)
    const registry = new CommentBackendRegistry(factory)
    const deps = {
      consoleUrl: 'https://a.example',
      getState: async () => ({ cookies: [], localStorage: {} }),
      createSession: async () => {
        throw new Error('noop')
      },
    }

    await registry.ensure('acc1', deps)
    await registry.ensure('acc1', deps)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })
})
