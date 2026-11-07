// B2 评论后端：headless 真实 Chrome 承载官方中控台页，读取 comment/info 评论流。
// 设计：真实 Chrome 引擎（非 Electron 渲染进程）→ 规避壳环境风控；登录态由会话层注入。
import { createLogger } from '#/logger'
import type {
  BackendComment,
  CommentBackendDeps,
  CommentBackendLike,
  CommentBackendStatus,
} from './contracts'
import { createCommentDeduper, parseCommentInfos } from './parseCommentInfos'
import { buildStorageState, isLoginUrl } from './storageState'

const COMMENT_INFO_PATH = '/api/anchor/comment/info'

export class RealChromeCommentBackend implements CommentBackendLike {
  private logger = createLogger('CommentBackend')
  private session: { close: () => Promise<void> } | null = null
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
    this.setStatus({ state: 'stopped' })
    if (session) await session.close().catch(() => {})
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
    }
  }

  private setStatus(patch: Partial<CommentBackendStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.onStatus?.(this.getStatus())
  }
}
