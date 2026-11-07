// B2 评论后端：headless 真实 Chrome 承载官方 console 页，读取 comment/info 评论流。
// 设计要点：
//  - 载体是真实 Chrome（findChromium）+ stealth，不是 Electron 渲染进程 → 规避壳环境风控；
//  - 登录态由调用方注入（壳 attach 会话的 cookies + localStorage 快照），backend 不读写壳 partition；
//  - 纯依赖注入（launch/nav/log/clock），便于单测；解析逻辑在 parseCommentInfos（纯函数）。
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { createLogger } from '#/logger'
import { createCommentDeduper, parseCommentInfos, type BackendComment } from './parseCommentInfos'

export type CommentBackendState = 'idle' | 'starting' | 'live' | 'degraded' | 'stopped' | 'error'

export interface CommentBackendStatus {
  state: CommentBackendState
  lastCommentAt?: number
  comments: number
  error?: string
}

export interface CommentBackendDeps {
  /** 由会话层注入：启动 headless 真实 Chrome 并返回会话（page 需已带 storageState） */
  createSession: () => Promise<BrowserSession>
  /** 注入 console 页 URL（平台知识由调用方提供） */
  consoleUrl: string
  /** 评论回调（去重后） */
  onComment?: (c: BackendComment) => void
  onStatus?: (s: CommentBackendStatus) => void
  now?: () => number
}

const COMMENT_INFO_PATH = '/api/anchor/comment/info'

export class RealChromeCommentBackend {
  private logger = createLogger('CommentBackend')
  private session: BrowserSession | null = null
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
      const session = await this.deps.createSession()
      this.session = session
      this.stopped = false
      const page = session.page
      page.on('response', resp => {
        if (!resp.url().includes(COMMENT_INFO_PATH)) return
        void resp
          .text()
          .then(body => this.handleBody(body))
          .catch(() => {})
      })
      page.on('crash', () => this.setStatus({ state: 'degraded', error: 'backend page crash' }))
      await page.goto(this.deps.consoleUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
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
    this.stopped = true
    const session = this.session
    this.session = null
    this.setStatus({ state: 'stopped' })
    if (session) await session.browser.close().catch(() => {})
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
      this.deps.onComment?.(c)
    }
  }

  private setStatus(patch: Partial<CommentBackendStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.onStatus?.(this.getStatus())
  }
}
