// 静默失效判定（W4）：区分「直播没人评论」与「读链路已经断了」。
//
// 为什么必须独立成模块：这两个状态在 UI 上表现完全一样（都是 0 条新评论）。
// 旧实现里 `page.on('response')` 不命中时没有任何信号，面板永远 0 条且无原因（P1-7）。
// 判定基准不是「有没有新评论」，而是「comment/info 响应还来不来」—— 2s 轮询正常返回空列表
// 属于健康，30s 一次响应都没有才是失效。
//
// 定时器与时钟全部可注入：单测不 sleep、不依赖真实 setInterval。

export const STALE_MS = 30_000
export const TICK_MS = 5_000

/**
 * 是否已静默超时。
 * - 从未收到过基线（undefined）= 启动中，不判失效（否则启动瞬间就报 degraded）
 * - now < lastFreshAt = 时钟回拨，保守不降级（误报比漏报更伤信任）
 */
export function isStale(lastFreshAt: number | undefined, now: number, staleMs = STALE_MS): boolean {
  if (lastFreshAt === undefined) return false
  if (!Number.isFinite(lastFreshAt)) return false
  if (now < lastFreshAt) return false
  return now - lastFreshAt > staleMs
}

export interface StaleWatcherOptions {
  /** 读当前基线（最近一次结构合法响应的时间） */
  getLastFreshAt: () => number | undefined
  /** 判定失效时回调（由 backend 负责改状态 + 告警） */
  onStale: () => void
  /**
   * 每次 tick 的前置健康检查：返回 false 表示**后端进程已死**。
   * 为什么单独一条：进程被系统杀掉时，"多久没数据"要等 30s 阈值才暴露，而进程死亡是
   * 立即可判定的 —— 早发现早重启，采集侧不再静默死亡。
   */
  isAlive?: () => boolean
  /** 后端进程已死时的回调（与 onStale 区分：一个是"没数据"，一个是"采集器没了"） */
  onExit?: (reason: string) => void
  staleMs?: number
  tickMs?: number
  now?: () => number
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

export interface StaleWatcher {
  start(): void
  stop(): void
  isRunning(): boolean
  /** 手动推一拍（生产由定时器调用，测试直接调）；返回本次是否触发失效 */
  tick(): boolean
  /** 收到新数据后复位：允许下一轮失效再次上报 */
  reset(): void
}

export function createStaleWatcher(opts: StaleWatcherOptions): StaleWatcher {
  const staleMs = opts.staleMs ?? STALE_MS
  const tickMs = opts.tickMs ?? TICK_MS
  const now = opts.now ?? Date.now
  const schedule =
    opts.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms)
      // unref：定时器不应阻止进程退出（Electron 主进程退出时尤其重要）
      ;(t as { unref?: () => void }).unref?.()
      return t
    })
  const cancel = opts.cancel ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout))

  let handle: unknown = null
  /** 单次失效只上报一次，收到数据后 reset */
  let fired = false

  function tick(): boolean {
    if (fired) return false
    // 进程死亡优先判定：不必等满 staleMs（30s），5s 内即可发现
    if (opts.isAlive && !opts.isAlive()) {
      fired = true
      opts.onExit?.('browser-disconnected')
      return true
    }
    if (!isStale(opts.getLastFreshAt(), now(), staleMs)) return false
    fired = true
    opts.onStale()
    return true
  }

  return {
    start() {
      if (handle !== null) return
      fired = false
      handle = schedule(tick, tickMs)
    },
    stop() {
      if (handle === null) return
      cancel(handle)
      handle = null
      fired = false
    },
    isRunning() {
      return handle !== null
    },
    tick,
    reset() {
      fired = false
    },
  }
}
