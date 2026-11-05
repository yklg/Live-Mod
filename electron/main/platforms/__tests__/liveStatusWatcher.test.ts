import type { Page } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveStatusWatcher } from '../liveStatusWatcher'

// ===== 测试基础设施 =====
// fake page + 可编程信号源：状态机语义（armed 锁存/缺席计数/恰好一次/异常容错）
// 全部在 watcher 层验证，平台 DOM 探测（checkLive/checkEnded）由 fake 替代。

type SignalState = {
  live: boolean
  ended: boolean
  throwOn: null | 'live' | 'ended'
  pageNull: boolean
}

function setup(overrides?: { pollIntervalMs?: number; missThreshold?: number }) {
  const state: SignalState = { live: false, ended: false, throwOn: null, pageNull: false }
  const checkLive = vi.fn(async () => {
    if (state.throwOn === 'live') throw new Error('Execution context was destroyed')
    return state.live
  })
  const checkEnded = vi.fn(async () => {
    if (state.throwOn === 'ended') throw new Error('Frame was detached')
    return state.ended
  })
  const onLiveEnd = vi.fn()
  const loggerStub: Record<string, unknown> = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  }
  loggerStub.scope = loggerStub
  const logger = loggerStub as unknown as Parameters<typeof createLiveStatusWatcher>[0]['logger']
  const fakePage = { isClosed: () => false } as unknown as Page
  const watcher = createLiveStatusWatcher({
    getPage: () => (state.pageNull ? null : fakePage),
    signals: { checkLive, checkEnded },
    onLiveEnd,
    logger,
    ...overrides,
  })
  const interval = overrides?.pollIntervalMs ?? 5000
  /** 冲刷首帧轮询的微任务 */
  const flush = () => vi.advanceTimersByTimeAsync(0)
  /** 推进 n 轮轮询 */
  const tick = (n = 1) => vi.advanceTimersByTimeAsync(n * interval)
  return { state, checkLive, checkEnded, onLiveEnd, logger, watcher, flush, tick }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('liveStatusWatcher 状态机（S1-S7）', () => {
  it('S1 [armed 锁存·P0 回归] 从未观测到直播中时，缺席永不触发（未开播先连接待命）', async () => {
    const t = setup()
    t.watcher.start()
    await t.tick(10)
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    t.watcher.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('S2 [缺席计数] armed 后连续缺席达阈值触发', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    await t.flush() // 第 1 轮：观测到直播中 → armed
    expect(t.checkLive).toHaveBeenCalledTimes(1)
    t.state.live = false
    await t.tick(2) // miss 1、2
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    await t.tick(1) // miss 3 → 触发
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('S3 [暂停容错] 缺席中途复现则计数清零', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    await t.flush()
    t.state.live = false
    await t.tick(2) // miss 2
    t.state.live = true
    await t.tick(1) // 复现 → miss 清零
    t.state.live = false
    await t.tick(2) // miss 2（若未清零此处即触发）
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    await t.tick(1) // miss 3 → 触发
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    t.watcher.stop()
  })

  it('S4 [确定性信号] 弹窗信号不依赖 armed，首帧立即触发', async () => {
    const t = setup()
    t.state.ended = true // 从未直播中（live=false），armed 未置位
    t.watcher.start()
    await t.flush()
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(t.checkEnded).toHaveBeenCalledTimes(1)
  })

  it('S5 [不变量] onLiveEnd 恰好一次，触发后轮询链自停', async () => {
    const t = setup()
    t.state.ended = true
    t.watcher.start()
    await t.flush()
    await t.tick(5) // 触发后继续推进：running=false，无任何后续轮询
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(t.checkEnded).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('S6 [可重入] onLiveEnd 回调链内同步调用 stop() 安全', async () => {
    const t = setup()
    t.onLiveEnd.mockImplementation(() => {
      t.watcher.stop() // 模拟 onLiveEnd → disconnect → stopLiveStatusWatch 重入
    })
    t.state.ended = true
    expect(() => {
      t.watcher.start()
    }).not.toThrow()
    await t.flush()
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('S7 [页面失效] page 为 null/closed 时跳过本轮且不计数', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    await t.flush() // armed
    t.state.pageNull = true
    await t.tick(10) // 缺席但页面无效：不计数、不触发
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    t.watcher.stop()
  })
})

describe('liveStatusWatcher 异常与边界（TC-U1 ~ TC-U7）', () => {
  it('TC-U1 [P0 异常分支] 信号抛 Execution context destroyed：跳过本轮不计数，轮询链存活', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    await t.flush() // armed
    t.state.live = false
    t.state.throwOn = 'live'
    await t.tick(2) // 两轮异常：miss 不增长
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    expect(t.logger.verbose).toHaveBeenCalled()
    t.state.throwOn = null
    await t.tick(2) // miss 1、2（异常轮未消耗计数）
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    await t.tick(1) // miss 3 → 触发
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
  })

  it('TC-U2 [异常分支] checkEnded 抛错：捕获后不触发且轮询链存活，恢复后仍可触发', async () => {
    const t = setup()
    t.state.ended = true
    t.state.throwOn = 'ended'
    t.watcher.start()
    await t.flush()
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    t.state.throwOn = null
    await t.tick(1)
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    t.watcher.stop()
  })

  it('TC-U3 [边界值] miss=阈值-1 不触发，恰=阈值触发', async () => {
    const t = setup({ missThreshold: 3 })
    t.state.live = true
    t.watcher.start()
    await t.flush()
    t.state.live = false
    await t.tick(2)
    expect(t.onLiveEnd).not.toHaveBeenCalled() // 阈值-1
    await t.tick(1)
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1) // 恰=阈值
  })

  it('TC-U4 [优先级] 弹窗与直播中信号同帧出现：弹窗优先，只触发一次', async () => {
    const t = setup()
    t.state.live = true
    t.state.ended = true
    t.watcher.start()
    await t.flush()
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(t.checkLive).not.toHaveBeenCalled() // ended 命中后当轮不再查 live
    t.watcher.stop()
  })

  it('TC-U5 [幂等] start() 双调只存在一条轮询链', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    t.watcher.start() // 第二次应为 no-op
    await t.tick(1) // 首帧 + 1 轮 = 2 次，而非 4 次
    expect(t.checkLive).toHaveBeenCalledTimes(2)
    t.watcher.stop()
  })

  it('TC-U6 [重启复位] start→stop→start 后 armed/miss 回到初始状态', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    await t.flush() // armed
    t.state.live = false
    await t.tick(1) // miss 1
    t.watcher.stop()
    t.watcher.start() // 重启：armed/miss 复位
    await t.flush() // 首帧缺席但未 armed → 不计数
    await t.tick(5) // 持续缺席仍不触发
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    t.state.live = true
    await t.tick(1) // 重新观测到直播中 → armed
    t.state.live = false
    await t.tick(3) // 完整 3 连缺席 → 触发
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
  })

  it('TC-U7 [参数] 自定义 pollIntervalMs / missThreshold 生效', async () => {
    const t = setup({ pollIntervalMs: 1000, missThreshold: 1 })
    t.state.live = true
    t.watcher.start()
    await t.flush() // armed（1000ms 间隔）
    t.state.live = false
    await vi.advanceTimersByTimeAsync(1000) // miss 1 = 阈值 → 触发
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
