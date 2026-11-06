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
  /** 页面身份观测结果（true=仍在中控台） */
  observing: boolean
}

function setup(overrides?: {
  pollIntervalMs?: number
  missThreshold?: number
  /** 提供页面身份观测能力（isObservingPage/onUnobservable） */
  observePage?: boolean
  /** 身份观测自身抛错（验证「单轮异常跳过」容错不变） */
  observeThrows?: boolean
}) {
  const state: SignalState = {
    live: false,
    ended: false,
    throwOn: null,
    pageNull: false,
    observing: true,
  }
  const checkLive = vi.fn(async () => {
    if (state.throwOn === 'live') throw new Error('Execution context was destroyed')
    return state.live
  })
  const checkEnded = vi.fn(async () => {
    if (state.throwOn === 'ended') throw new Error('Frame was detached')
    return state.ended
  })
  const onLiveEnd = vi.fn()
  const onUnobservable = vi.fn()
  const isObservingPage = vi.fn(async () => {
    if (overrides?.observeThrows) throw new Error('Execution context was destroyed')
    return state.observing
  })
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
  const { pollIntervalMs, missThreshold, observePage } = overrides ?? {}
  const watcher = createLiveStatusWatcher({
    getPage: () => (state.pageNull ? null : fakePage),
    signals: { checkLive, checkEnded },
    onLiveEnd,
    logger,
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(missThreshold !== undefined ? { missThreshold } : {}),
    ...(observePage ? { isObservingPage, onUnobservable } : {}),
  })
  const interval = pollIntervalMs ?? 5000
  /** 冲刷首帧轮询的微任务 */
  const flush = () => vi.advanceTimersByTimeAsync(0)
  /** 推进 n 轮轮询 */
  const tick = (n = 1) => vi.advanceTimersByTimeAsync(n * interval)
  return {
    state,
    checkLive,
    checkEnded,
    onLiveEnd,
    onUnobservable,
    isObservingPage,
    logger,
    watcher,
    flush,
    tick,
  }
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

// ===== A3 页面身份观测（缺席 ≠ 下播）=====
// 契约：提供 isObservingPage 时，不可观测的轮次「不查信号、不计数、绝不 fire」，
// onUnobservable 每次进入不可观测只回调一次；恢复可观测后 armed/missThreshold 原语义不变。
describe('liveStatusWatcher 页面身份观测（A3 / TC-O1 ~ TC-O5）', () => {
  it('TC-O1 [不可观测不计数不 fire] 已 armed 后页面漂移：停查信号、缺席计数归零、只回调一次', async () => {
    const t = setup({ observePage: true })
    t.state.live = true
    t.watcher.start()
    await t.flush() // 首帧：可观测 + 直播中 → armed
    expect(t.checkEnded).toHaveBeenCalledTimes(1)

    t.state.observing = false // 壳层把会话页折叠导航走 → 不再可观测
    await t.tick(10) // 持续不可观测：即使「找不到直播中 tag」也不计数、不触发
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    expect(t.checkLive).toHaveBeenCalledTimes(1) // 漂移后不再探测信号
    expect(t.checkEnded).toHaveBeenCalledTimes(1)
    expect(t.onUnobservable).toHaveBeenCalledTimes(1) // 连续不可观测只回调一次
    t.watcher.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('TC-O2 [onUnobservable 恰好一次] 恢复可观测后再次进入可再回调（进入沿触发）', async () => {
    const t = setup({ observePage: true })
    t.state.live = true
    t.watcher.start()
    await t.flush() // 可观测

    t.state.observing = false
    await t.tick(3)
    expect(t.onUnobservable).toHaveBeenCalledTimes(1)

    t.state.observing = true // 回到中控台：清不可观测标记
    await t.tick(2)
    expect(t.onUnobservable).toHaveBeenCalledTimes(1) // 可观测期间不再回调

    t.state.observing = false // 再次漂移：进入沿 → 第二次回调
    await t.tick(2)
    expect(t.onUnobservable).toHaveBeenCalledTimes(2)
    t.watcher.stop()
  })

  it('TC-O3 [恢复后语义保持] 漂移清零缺席计数，但 armed 锁存保留：回中控台后重新攒满阈值才触发', async () => {
    const t = setup({ observePage: true })
    t.state.live = true
    t.watcher.start()
    await t.flush() // armed
    t.state.live = false
    await t.tick(2) // miss 1、2（阈值 3）
    expect(t.onLiveEnd).not.toHaveBeenCalled()

    t.state.observing = false // 漂移：missCount 归零
    await t.tick(5)
    expect(t.checkLive).toHaveBeenCalledTimes(3) // armed 轮 + 2 轮缺席后不再探测
    expect(t.onLiveEnd).not.toHaveBeenCalled()

    t.state.observing = true // 恢复可观测：若 armed 丢失则永不触发；若 miss 未清零则此处会提前触发
    await t.tick(2) // miss 1、2
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    await t.tick(1) // miss 3 → 触发（armed 保持 + miss 从零开始）
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
  })

  it('TC-O4 [未 armed 语义不变] 漂移期间不产生 armed；恢复后须先观测到直播中才武装', async () => {
    const t = setup({ observePage: true })
    t.state.observing = false // 连接后页面就不在中控台
    t.watcher.start()
    await t.flush()
    await t.tick(5)
    expect(t.onUnobservable).toHaveBeenCalledTimes(1)
    expect(t.checkLive).not.toHaveBeenCalled()

    t.state.observing = true // 回中控台，但直播中信号缺席（未开播/待命）
    await t.tick(10)
    expect(t.onLiveEnd).not.toHaveBeenCalled() // 未 armed：缺席永不触发

    t.state.live = true // 观测到直播中 → armed
    await t.tick(1)
    t.state.live = false
    await t.tick(3) // 完整 3 连缺席 → 触发
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
  })

  it('TC-O5 [无身份能力行为不变] 未提供 isObservingPage 时保持原缺席计数语义、不回调 onUnobservable', async () => {
    const t = setup()
    t.state.live = true
    t.watcher.start()
    await t.flush() // armed
    t.state.live = false
    await t.tick(3)
    expect(t.onLiveEnd).toHaveBeenCalledTimes(1)
    expect(t.onUnobservable).not.toHaveBeenCalled()
    expect(t.isObservingPage).not.toHaveBeenCalled()
  })

  it('TC-O6 [异常容错不变] 身份观测自身抛错：本轮跳过（不计数、不 fire），轮询链存活', async () => {
    const t = setup({ observePage: true, observeThrows: true })
    t.state.live = true
    t.watcher.start()
    await t.flush() // 首帧观测抛错 → 本轮跳过
    expect(t.onLiveEnd).not.toHaveBeenCalled()
    expect(t.checkLive).not.toHaveBeenCalled()
    expect(t.onUnobservable).not.toHaveBeenCalled() // 抛错 ≠ 进入不可观测
    expect(t.logger.verbose).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1) // 轮询链存活
    t.watcher.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
