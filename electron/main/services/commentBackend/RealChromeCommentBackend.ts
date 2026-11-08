// B2 评论后端：headless 真实 Chrome 承载官方中控台页，读取 comment/info 评论流。
// 设计：真实 Chrome 引擎（非 Electron 渲染进程）→ 规避壳环境风控；登录态由会话层注入。
import { createLogger } from '#/logger'
import type {
  BackendComment,
  CommentBackendDeps,
  CommentBackendLike,
  CommentBackendStatus,
  CommentSendResult,
} from './contracts'
import { createCommentDeduper, isCommentInfoBody, parseCommentInfos } from './parseCommentInfos'
import { createStaleWatcher, type StaleWatcher } from './staleWatcher'
import { buildStorageState, isLoginUrl } from './storageState'

const COMMENT_INFO_PATH = '/api/anchor/comment/info'

export class RealChromeCommentBackend implements CommentBackendLike {
  private logger = createLogger('CommentBackend')
  private page: import('playwright').Page | null = null
  private session: { close: () => Promise<void> } | null = null
  private listeners = new Set<(c: BackendComment) => void>()
  private deduper = createCommentDeduper()
  private status: CommentBackendStatus = { state: 'idle', comments: 0 }
  private stopped = false
  /** 最近一次「结构合法响应」的时间（含空列表）：静默失效判定基线 */
  private lastFreshAt?: number
  /** 浏览器进程存活探针（缺失则视为存活，避免旧调用方被误判） */
  private isConnected: () => boolean = () => true
  private readonly staleWatcher: StaleWatcher

  constructor(private deps: CommentBackendDeps) {
    this.staleWatcher = createStaleWatcher({
      getLastFreshAt: () => this.lastFreshAt,
      onStale: () => this.handleStale(),
      // 进程死亡 5s 内可判（不必等满 30s 无数据阈值）
      isAlive: () => this.isAlive(),
      onExit: reason => this.handleExit(reason),
      now: deps.now,
    })
  }

  /** 存活探针：浏览器进程是否还在（headless Chrome 会被系统/OOM 静默杀掉） */
  isAlive(): boolean {
    if (this.stopped) return false
    try {
      return this.isConnected()
    } catch {
      return false
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  getStatus(): CommentBackendStatus {
    return { ...this.status }
  }

  async start(): Promise<CommentBackendStatus> {
    if (this.session) return this.getStatus()
    this.setStatus({ state: 'starting' })
    try {
      const snapshot = await this.deps.getState()
      const storageState = buildStorageState(snapshot, this.deps.consoleUrl)
      const handle = await this.deps.createSession(storageState)
      this.session = handle
      this.isConnected = handle.isConnected ?? (() => true)
      this.stopped = false
      const page = handle.page
      this.page = page
      page.on('response', resp => {
        if (!resp.url().includes(COMMENT_INFO_PATH)) return
        void resp
          .text()
          .then(body => this.handleBody(body))
          .catch(() => {})
      })
      page.on('crash', () => this.setStatus({ state: 'degraded', error: 'backend page crash' }))
      await page.goto(this.deps.consoleUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      if (isLoginUrl(page.url())) {
        this.setStatus({ state: 'degraded', error: '登录态失效（后端页落在登录/SSO）' })
        return this.getStatus()
      }
      this.setStatus({ state: 'live' })
      // 失效检测基线：从这里开始计时，之后每收到一次结构合法响应就刷新
      this.lastFreshAt = this.now()
      this.staleWatcher.start()
      this.logger.success('B2 评论后端已启动（headless 真实 Chrome）')
      return this.getStatus()
    } catch (e) {
      const message = String(e).slice(0, 300)
      this.setStatus({ state: 'error', error: message })
      this.logger.warn('B2 评论后端启动失败：', message)
      await this.stop()
      return this.getStatus()
    }
  }

  async stop(): Promise<void> {
    if (this.stopped && !this.session) return
    this.stopped = true
    this.staleWatcher.stop()
    const session = this.session
    this.session = null
    this.page = null
    this.listeners.clear()
    this.setStatus({ state: 'stopped' })
    if (session) await session.close().catch(() => {})
  }

  /** 订阅评论流（任务层读链路）：返回取消订阅 */
  subscribe(listener: (c: BackendComment) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 发送评论/回复（自动回复闭环）：headless 页评论区原生 setter 填值 + Enter，
   * 以发送接口（operate_v2/publish）响应作为成功判据（≤10s，契约见计划 v1.1 A5/A8）。
   */
  async sendReply(text: string): Promise<CommentSendResult> {
    const page = this.page
    if (!page) return { ok: false, error: '评论后端未启动' }
    const content = text.trim()
    if (!content) return { ok: false, error: '回复内容为空' }
    try {
      const filled = await page.evaluate((value: string) => {
        // 官方中控台评论框：textarea[placeholder*="回复观众或直接发评"]（两平台同形）
        const byPlaceholder = [...document.querySelectorAll('textarea')].find(el =>
          (el.getAttribute('placeholder') || '').includes('回复观众或直接发评'),
        )
        const target =
          byPlaceholder ??
          [...document.querySelectorAll('textarea')].find(
            el => el.getBoundingClientRect().width > 100,
          )
        if (!target) return false
        target.focus()
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set
        setter?.call(target, value)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }, content)
      if (!filled) return { ok: false, error: '未找到评论输入框（页面可能已离开中控台）' }
      const waitResponse = page
        .waitForResponse(
          resp =>
            /\/api\/anchor\/comment\/(operate_v2|publish)/.test(resp.url()) &&
            resp.request().method() === 'POST',
          { timeout: 10_000 },
        )
        .catch(() => null)
      await page.keyboard.press('Enter')
      const resp = await waitResponse
      if (!resp) return { ok: false, error: '发送超时（未观测到发送接口响应）' }
      if (!resp.ok()) return { ok: false, error: `发送接口 HTTP ${resp.status()}` }
      this.logger.success(`B2 已发送评论：${content.slice(0, 40)}`)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) }
    }
  }

  /** 单轮评论响应处理（测试可直接调用） */
  handleBody(body: string): void {
    if (this.stopped) return
    // 结构不合法（空体/非 JSON/缺 comment_infos）不代表链路活着，不刷新基线
    if (!isCommentInfoBody(body)) return

    const now = this.now()
    // 关键：合法响应即刷新基线 —— 哪怕本轮 0 条新评论（直播没人说话 ≠ 链路断了）
    this.lastFreshAt = now
    this.staleWatcher.reset()

    const fresh = this.deduper.take(parseCommentInfos(body, now))
    if (!fresh.length) {
      // 降级后收到任何合法响应即认定链路恢复
      if (this.status.state === 'degraded') {
        this.setStatus({ state: 'live', degradedReason: undefined })
      }
      return
    }

    this.status.comments += fresh.length
    this.setStatus({ state: 'live', lastCommentAt: now, degradedReason: undefined })
    for (const c of fresh) {
      this.logger.info(`B2 评论：${c.nickName}：${c.content.slice(0, 60)}`)
      this.deps.onComment?.(c as BackendComment)
      for (const listener of this.listeners) listener(c as BackendComment)
    }
  }

  /**
   * 手动推一拍失效检测（生产由 staleWatcher 的定时器调用；单测直接调，避免 sleep）。
   * 只在 live 状态下降级：starting/error/stopped 各有自己的语义，不该被"没数据"覆盖。
   */
  tickStaleCheck(): boolean {
    // stop 后不得再判定失效：定时器虽已取消，但手动/迟到的调用仍需给出"未失效"语义，
    // 否则调用方会误以为读链路出了问题（状态机已 stopped，不是 degraded）
    if (this.stopped) return false
    return this.staleWatcher.tick()
  }

  private handleStale(): void {
    if (this.stopped) return
    if (this.status.state !== 'live') return
    this.setStatus({
      state: 'degraded',
      degradedReason: 'no-data',
      lastFreshAt: this.lastFreshAt,
    })
    this.logger.warn('B2 评论读链路超过 30s 无 comment/info 响应，标记为可能失效')
  }

  /**
   * 采集进程已死（headless Chrome 被系统杀掉 / 崩溃）。
   * 必须显式上报：此前这种故障是**静默**的 —— 进程消失、日志无 stop 记录、
   * 面板永远 0 条，用户只能对着空白猜测（实测：启动 3.9 小时后进程消失）。
   */
  private handleExit(reason: string): void {
    if (this.stopped) return
    this.setStatus({ state: 'error', error: `B2 采集进程已退出（${reason}）` })
    this.logger.warn(`B2 采集进程已退出（${reason}），通知会话层重启`)
    this.deps.onBackendExit?.(reason)
  }

  private setStatus(patch: Partial<CommentBackendStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.onStatus?.(this.getStatus())
  }
}
