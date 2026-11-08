// B2 评论后端注册表：按账号管理 headless 真实 Chrome 后端生命周期（多账号隔离、上限、停止）
import type { CommentBackendDeps, CommentBackendLike, CommentBackendStatus } from './contracts'
import { RealChromeCommentBackend } from './RealChromeCommentBackend'

export interface CommentBackendEntry {
  accountId: string
  status: CommentBackendStatus
}

export type CommentBackendFactory = (deps: CommentBackendDeps) => CommentBackendLike

/** 上限：避免每账号一个 headless Chrome 失控（计划 v1.1 A2） */
export const MAX_COMMENT_BACKENDS = 2

export class CommentBackendRegistry {
  private backends = new Map<string, CommentBackendLike>()

  constructor(
    private factory: CommentBackendFactory = deps => new RealChromeCommentBackend(deps),
    private maxAccounts = MAX_COMMENT_BACKENDS,
  ) {}

  get size(): number {
    return this.backends.size
  }

  get(accountId: string): CommentBackendLike | undefined {
    return this.backends.get(accountId)
  }

  list(): CommentBackendEntry[] {
    return [...this.backends.entries()].map(([accountId, backend]) => ({
      accountId,
      status: backend.getStatus(),
    }))
  }

  async ensure(accountId: string, deps: CommentBackendDeps): Promise<CommentBackendStatus> {
    const existing = this.backends.get(accountId)
    if (existing) {
      // 采集进程已死（headless Chrome 被系统杀掉）→ 旧实例留着只会永远空白，必须重建
      if (existing.isAlive && !existing.isAlive()) {
        this.backends.delete(accountId)
        await existing.stop().catch(() => {})
      } else {
        return existing.getStatus()
      }
    }
    if (this.backends.size >= this.maxAccounts) {
      throw new Error(`评论后端账号数已达上限（${this.maxAccounts}），拒绝启动 ${accountId}`)
    }
    if (process.env.LM_COMMENT_BACKEND === '0') {
      return { state: 'stopped', comments: 0, error: 'LM_COMMENT_BACKEND=0 已禁用' }
    }
    const backend = this.factory(deps)
    this.backends.set(accountId, backend)
    const status = await backend.start()
    if (status.state === 'error') this.backends.delete(accountId)
    return status
  }

  async stop(accountId: string): Promise<void> {
    const backend = this.backends.get(accountId)
    if (!backend) return
    this.backends.delete(accountId)
    await backend.stop()
  }

  async stopAll(): Promise<void> {
    const entries = [...this.backends.entries()]
    this.backends.clear()
    await Promise.all(entries.map(([, b]) => b.stop().catch(() => {})))
  }
}

export const commentBackendRegistry = new CommentBackendRegistry()
