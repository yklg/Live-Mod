import type { Page } from 'playwright'
import type { ScopedLogger } from '#/logger'

/**
 * 平台直播状态信号：DOM 探测由平台实现，状态机语义（armed 锁存 / 缺席计数 /
 * 恰好一次触发 / 异常容错）由 watcher 统一持有，便于各平台与单测复用。
 */
export interface LiveStatusSignals {
  /** 是否存在「直播中」信号（如【直播中】tag） */
  checkLive: (page: Page) => Promise<boolean>
  /**
   * 是否存在确定性「直播结束」信号（如直播结束后弹出的「直播总结」弹窗）。
   * 该信号只在真实下播后出现，不受 armed 锁存约束；实现内负责顺手点掉弹窗，
   * 点掉失败不得阻断信号返回。
   */
  checkEnded: (page: Page) => Promise<boolean>
}

export interface LiveStatusWatcherOptions {
  getPage: () => Page | null | undefined
  signals: LiveStatusSignals
  onLiveEnd: () => void
  logger: ScopedLogger
  /** 轮询间隔，默认 5000ms */
  pollIntervalMs?: number
  /** 「直播中」信号连续缺席达到该次数判定下播，默认 3（≈15s 防抖） */
  missThreshold?: number
  /**
   * 页面身份校验（平台适配器提供，如 `async page => isControlPageUrl(page.url())`）。
   * 返回 false = 当前页已不是中控台（壳层折叠导航/业务跳转/页面被替换）→ 本轮视为「不可观测」：
   * **不查 checkEnded/checkLive、缺席计数归零、绝不 fire**。
   * 关键语义：**缺席 ≠ 下播**——看不到信号只能说明「这一轮不可观测」，不能作为下播证据。
   * 未提供该能力 → 跳过身份观测，watcher 行为与改造前完全一致。
   */
  isObservingPage?: (page: Page) => Promise<boolean>
  /**
   * 进入「不可观测」状态时回调一次（连续多轮不可观测只回调一次；
   * 恢复可观测后再次进入可再回调）。用于上层告警（toast/日志），不参与下播判定。
   */
  onUnobservable?: () => void
}

/**
 * 直播结束检测器：轮询中控台页面信号状态机。
 *
 * 判定规则：
 * - 缺席信号（checkLive 连续未命中）只有在 armed 后才计数——armed 由
 *   「至少观测到一次直播中」置位，防止「主播未开播、运营先连接待命」被误判为下播；
 * - 确定性结束信号（checkEnded）不受 armed 约束；
 * - **页面身份优先（A3）**：提供了 isObservingPage 时，每轮先校验当前页仍是中控台；
 *   不可观测的轮次不查信号、缺席计数归零、绝不 fire（缺席 ≠ 下播），
 *   只在进入不可观测时回调 onUnobservable 一次；恢复可观测后 armed/miss 语义原样继续；
 * - 单轮异常（Playwright 在页面导航瞬间抛 Execution context was destroyed 等）
 *   跳过本轮继续轮询，绝不令检测链静默死亡；
 * - onLiveEnd 恰好触发一次（ended 先置位再回调，回调链同步重入 stop() 安全）。
 */
export function createLiveStatusWatcher(options: LiveStatusWatcherOptions) {
  const pollIntervalMs = options.pollIntervalMs ?? 5000
  const missThreshold = options.missThreshold ?? 3

  let running = false
  let armed = false
  let missCount = 0
  let ended = false
  /** 是否处于「不可观测」状态（连续不可观测只回调 onUnobservable 一次） */
  let unobservable = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule() {
    if (running && !ended) {
      timer = setTimeout(poll, pollIntervalMs)
    }
  }

  function fire() {
    // 先置位再回调：onLiveEnd → disconnect → stop() 会同步重入当前轮询回调
    ended = true
    running = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    options.onLiveEnd()
  }

  async function poll() {
    timer = null
    if (!running || ended) return
    try {
      const page = options.getPage()
      // 页面未就绪/已关闭：跳过本轮，不计数
      if (!page || page.isClosed()) {
        schedule()
        return
      }
      // 页面身份优先：先确认「这一轮看到的还是中控台」，再谈信号有无。
      // 不可观测（页面已被折叠导航/跳转走）时缺席计数归零且不查信号——
      // 「缺席 ≠ 下播」：看不到信号的页面不能作为下播证据，否则一次业务弹窗就会误判下播。
      if (options.isObservingPage) {
        const observing = await options.isObservingPage(page)
        if (!observing) {
          missCount = 0
          if (!unobservable) {
            unobservable = true
            options.onUnobservable?.()
          }
          schedule()
          return
        }
        // 恢复可观测：清除不可观测标记；armed/missCount 维持原语义（armed 锁存不因漂移丢失）
        unobservable = false
      }
      // 确定性结束信号优先（弹窗出现即真实下播，点掉由 signals 实现负责）
      if (await options.signals.checkEnded(page)) {
        fire()
        return
      }
      if (await options.signals.checkLive(page)) {
        armed = true
        missCount = 0
      } else if (armed) {
        missCount++
        if (missCount >= missThreshold) {
          fire()
          return
        }
      }
      // 未 armed 的缺席：跳过不计数
    } catch (error) {
      options.logger.verbose('直播状态轮询本轮异常，已跳过：', error)
    }
    schedule()
  }

  return {
    start() {
      // 幂等：运行中或已结束时重复调用无效；结束后不复用实例（重连应新建）
      if (running || ended) return
      running = true
      armed = false
      missCount = 0
      // 新观测会话：不可观测标记复位（随后首次轮询会重新判定并回调）
      unobservable = false
      poll()
    },
    stop() {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
