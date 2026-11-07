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
import { createCommentDeduper, parseCommentInfos } from './parseCommentInfos'
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

  constructor(private deps: CommentBackendDeps) {}

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
    const now = this.deps.now?.() ?? Date.now()
    const fresh = this.deduper.take(parseCommentInfos(body, now))
    if (!fresh.length) return
    this.status.comments += fresh.length
    this.setStatus({ state: 'live', lastCommentAt: now })
    for (const c of fresh) {
      this.logger.info(`B2 评论：${c.nickName}：${c.content.slice(0, 60)}`)
      this.deps.onComment?.(c as BackendComment)
      for (const listener of this.listeners) listener(c as BackendComment)
    }
  }

  private setStatus(patch: Partial<CommentBackendStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.onStatus?.(this.getStatus())
  }
}
