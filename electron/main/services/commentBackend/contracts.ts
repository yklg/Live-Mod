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
  /** 最近一次成功解析到 comment/info 的时间（ms）：静默失效判定基线（W4） */
  lastFreshAt?: number
  /** 降级归因，供 UI 文案与日志区分「没评论」与「读链路断了」 */
  degradedReason?: 'no-data' | 'poll-miss'
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
  /**
   * 浏览器进程存活探针（Playwright `Browser.isConnected()`）。
   * 为什么必须有：headless Chrome 会被系统/OOM 静默杀掉，之前没有任何人能察觉 ——
   * 后端死了但状态仍是 live，面板永远空白且无任何提示（实测：启动 3.9 小时后进程消失，日志无 stop 记录）。
   */
  isConnected?: () => boolean
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
  /**
   * 后端进程意外退出（headless Chrome 被系统杀掉 / 崩溃）时回调。
   * 会话层据此自动重启（带退避与次数上限）并告警 —— 否则采集侧静默死亡，
   * 消费侧只会看到"永远 0 条"，没有任何线索（这正是本次实测到的真实故障）。
   */
  onBackendExit?: (reason: string) => void
  now?: () => number
}

/** 发送结果（自动回复闭环用；失败原因透出给 UI/日志） */
export interface CommentSendResult {
  ok: boolean
  error?: string
}

/** 窄接口供 registry 持有（便于单测 fake；subscribe/sendReply 可选以保持向后兼容） */
export interface CommentBackendLike {
  start: () => Promise<CommentBackendStatus>
  stop: () => Promise<void>
  getStatus: () => CommentBackendStatus
  /**
   * 存活探针：浏览器进程是否还在。
   * registry 用它决定"复用还是重建"—— 进程被系统杀掉后旧实例留着只会永远空白。
   */
  isAlive?: () => boolean
  /** 订阅评论流（任务层读链路用）；返回取消订阅 */
  subscribe?: (listener: (c: BackendComment) => void) => () => void
  /** 发送评论/回复（自动回复发送链路用） */
  sendReply?: (text: string) => Promise<CommentSendResult>
}

/** 会话层适配：BrowserSession → BackendPageHandle */
export function toPageHandle(session: BrowserSession): BackendPageHandle {
  return {
    page: session.page,
    close: async () => {
      await session.browser.close().catch(() => {})
    },
    isConnected: () => session.browser.isConnected(),
  }
}
