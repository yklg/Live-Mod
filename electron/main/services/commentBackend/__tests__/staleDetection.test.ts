import { describe, expect, it, vi } from 'vitest'

// ===== 读链路静默失效检测（W4 · TC-SF1~SF6）=====
// 守护不变量：
//   C-SF1 29s 未刷新基线 → 仍 live（阈值内不误报）
//   C-SF2 31s → degraded，且带 degradedReason 与 lastFreshAt（能定位"多久没数据"）
//   C-SF3 收到合法响应立即回 live（含"合法但空列表"——没人评论 ≠ 链路断了）
//   C-SF4 stop() 后定时器必须取消（否则后台进程一直跑）
//   C-SF5 时钟回拨不降级（误报比漏报更伤信任）
//   C-SF6 合法空列表也刷新基线（这是区分"没人评论"与"接口断了"的唯一依据）

vi.mock('#/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  }),
}))

import { isCommentInfoBody } from '#/services/commentBackend/parseCommentInfos'
import { RealChromeCommentBackend } from '#/services/commentBackend/RealChromeCommentBackend'
import {
  createStaleWatcher,
  isStale,
  STALE_MS,
  TICK_MS,
} from '#/services/commentBackend/staleWatcher'

const bodyWith = (ids: string[]) =>
  JSON.stringify({
    data: {
      comment_infos: ids.map((id, i) => ({
        comment_id: id,
        nick_name: `u${i}`,
        content: `c-${id}`,
        create_time: 1,
      })),
    },
  })

const emptyBody = () => JSON.stringify({ data: { comment_infos: [] } })

function makeBackend(startAt = 1000) {
  const clock = { t: startAt }
  const backend = new RealChromeCommentBackend({
    consoleUrl: 'https://buyin.jinritemai.com/dashboard/live',
    createSession: vi.fn(),
    getState: vi.fn(),
    now: () => clock.t,
  })
  return { backend, clock }
}

describe('isStale 纯判定（TC-SF1 / SF5）', () => {
  it('TC-SF1 阈值内（29s）不判失效，超过阈值（31s）才判', () => {
    const base = 1_000
    expect(isStale(base, base + 29_000)).toBe(false)
    expect(isStale(base, base + STALE_MS)).toBe(false)
    expect(isStale(base, base + 31_000)).toBe(true)
  })

  it('TC-SF1b 从未收到基线（启动中）不判失效', () => {
    expect(isStale(undefined, 999_999)).toBe(false)
  })

  it('TC-SF5 时钟回拨（now < lastFreshAt）不判失效', () => {
    expect(isStale(10_000, 5_000)).toBe(false)
  })
})

describe('后端状态机（TC-SF2 / SF3 / SF6）', () => {
  it('TC-SF2 31s 无数据 → degraded，带原因与基线时间', () => {
    const { backend, clock } = makeBackend()
    backend.handleBody(bodyWith(['1']))
    expect(backend.getStatus().state).toBe('live')

    clock.t = 32_000
    expect(backend.tickStaleCheck()).toBe(true)

    const status = backend.getStatus()
    expect(status.state).toBe('degraded')
    expect(status.degradedReason).toBe('no-data')
    expect(status.lastFreshAt).toBe(1_000)
    // 同一次失效不重复上报（否则每 5s 刷一次告警）
    expect(backend.tickStaleCheck()).toBe(false)
  })

  it('TC-SF3 降级后收到新评论立即回 live', () => {
    const { backend, clock } = makeBackend()
    backend.handleBody(bodyWith(['1']))
    clock.t = 32_000
    backend.tickStaleCheck()
    expect(backend.getStatus().state).toBe('degraded')

    clock.t = 33_000
    backend.handleBody(bodyWith(['2']))

    const status = backend.getStatus()
    expect(status.state).toBe('live')
    expect(status.degradedReason).toBeUndefined()
    expect(status.comments).toBe(2)
  })

  it('TC-SF6 合法空列表也刷新基线（没人评论 ≠ 链路断了）', () => {
    const { backend, clock } = makeBackend()
    backend.handleBody(bodyWith(['1']))
    expect(backend.getStatus().state).toBe('live')

    // 20s 时收到一次空列表（链路健康），基线推到 20000
    clock.t = 20_000
    backend.handleBody(emptyBody())

    // 45s 时距基线只有 25s → 不应降级
    clock.t = 45_000
    expect(backend.tickStaleCheck()).toBe(false)
    expect(backend.getStatus().state).toBe('live')

    // 51s 时距基线 31s → 降级
    clock.t = 51_000
    expect(backend.tickStaleCheck()).toBe(true)
    expect(backend.getStatus().state).toBe('degraded')
  })

  it('TC-SF6b 结构不合法的响应不刷新基线', () => {
    expect(isCommentInfoBody('')).toBe(false)
    expect(isCommentInfoBody('not-json')).toBe(false)
    expect(isCommentInfoBody(JSON.stringify({ data: {} }))).toBe(false)
    expect(isCommentInfoBody(emptyBody())).toBe(true)
  })
})

describe('定时器生命周期（TC-SF4）', () => {
  it('TC-SF4 stop() 取消定时器，start 幂等', () => {
    let running: (() => void) | null = null
    const cancel = vi.fn(() => {
      running = null
    })
    const schedule = vi.fn((fn: () => void, ms: number) => {
      running = fn
      expect(ms).toBe(TICK_MS)
      return { id: 1 }
    })

    const watcher = createStaleWatcher({
      getLastFreshAt: () => 0,
      onStale: vi.fn(),
      now: () => 0,
      schedule,
      cancel,
    })

    watcher.start()
    watcher.start() // 幂等：不重复注册
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(watcher.isRunning()).toBe(true)
    expect(running).not.toBeNull()

    watcher.stop()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(watcher.isRunning()).toBe(false)
    expect(running).toBeNull()
  })

  it('TC-SF4b backend.stop() 后 tick 不再降级', async () => {
    const { backend, clock } = makeBackend()
    backend.handleBody(bodyWith(['1']))
    await backend.stop()

    clock.t = 99_000
    expect(backend.tickStaleCheck()).toBe(false)
    expect(backend.getStatus().state).toBe('stopped')
  })
})

// ===== 采集进程死亡（实测故障：headless Chrome 被系统杀掉，进程静默消失、日志无 stop、
// 面板永远 0 条）—— 必须 5s 内识别并上报，不能等满 30s 无数据阈值 =====
describe('采集进程死亡识别（TC-SF7 / TC-SF8）', () => {
  it('TC-SF7 进程已死 → 立即上报退出（不等 30s 阈值，且不触发"无数据"降级）', () => {
    let alive = true
    const onExit = vi.fn()
    const onStale = vi.fn()
    const watcher = createStaleWatcher({
      getLastFreshAt: () => 0,
      onStale,
      onExit,
      isAlive: () => alive,
      now: () => 100_000, // 已远超 30s 阈值，但真正的死因是"进程没了"
    })

    alive = false
    expect(watcher.tick()).toBe(true)
    expect(onExit).toHaveBeenCalledWith('browser-disconnected')
    expect(onStale).not.toHaveBeenCalled()
  })

  it('TC-SF8 进程存活但无数据 → 走"无数据"降级（不是退出）', () => {
    const onExit = vi.fn()
    const onStale = vi.fn()
    const watcher = createStaleWatcher({
      getLastFreshAt: () => 0,
      onStale,
      onExit,
      isAlive: () => true,
      now: () => 100_000,
    })

    expect(watcher.tick()).toBe(true)
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('TC-SF9 backend.isAlive() 反映浏览器进程状态', async () => {
    const { backend } = makeBackend()
    // 默认无探针 → 视为存活（不误判旧调用方）
    expect(backend.isAlive()).toBe(true)
    await backend.stop()
    // stop 之后一律视为不存活
    expect(backend.isAlive()).toBe(false)
  })
})
