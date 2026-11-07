// B2 评论后端 · 契约（平台无关；不依赖 Electron/managers，便于单测与依赖倒置）

import type { Page } from 'playwright'
import type { BrowserSession } from '#/managers/BrowserSessionManager'

export type CommentBackendState = 'idle' | 'starting' | 'live' | 'degraded' | 'stopped' | 'error'

/** 评论事件（跨轮询去重后的形态，字段对齐 comment/info data.comment_infos） */
export interface BackendComment {
  id: string
  nickName: string
  content: string
  at: number
  raw?: unknown
}

export interface CommentBackendStatus {
  state: CommentBackendState
  comments: number
  lastCommentAt?: number
  error?: string
}

/** 壳 attach 会话导出的登录态快照（仅内存传递，不落盘/不写日志） */
export interface CommentStateSnapshot {
  cookies: unknown[]
  localStorage: Record<string, string>
}

/** 后端的窄页面句柄：services 不直接依赖 managers 的 BrowserSession 全量类型 */
export interface BackendPageHandle {
  page: Page
  close: () => Promise<void>
}

/** 启动所需的依赖注入（AccountSession 提供实现；单测可注入 fake） */
export interface CommentBackendDeps {
  /** 由会话层提供：启动 headless 真实 Chrome（storageState 由 backend 根据快照构造） */
  createSession: (storageState: string) => Promise<BackendPageHandle>
  /** 由会话层提供：cookies/localStorage 快照 */
  getState: () => Promise<CommentStateSnapshot>
  /** 壳当前中控台页 URL（平台知识由会话层给，backend 不内建域名） */
  consoleUrl: string
  onComment?: (c: BackendComment) => void
  onStatus?: (s: CommentBackendStatus) => void
  now?: () => number
}

/** 窄接口供 registry 持有（便于单测 fake） */
export interface CommentBackendLike {
  start: () => Promise<CommentBackendStatus>
  stop: () => Promise<void>
  getStatus: () => CommentBackendStatus
}

/** 会话层适配：BrowserSession → BackendPageHandle */
export function toPageHandle(session: BrowserSession): BackendPageHandle {
  return {
    page: session.page,
    close: async () => {
      await session.browser.close().catch(() => {})
    },
  }
}
