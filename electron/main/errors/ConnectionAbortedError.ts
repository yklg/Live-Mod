import type { ConnectionFailureKind, SessionCloseReason } from './connectionError'

/**
 * 连接被中止（壳 v3 · Wave 1 · P0-1 的另一半）。
 *
 * 触发源：`AccountSession.disconnect(reason)` 调 `AbortController.abort(reason)`，
 * 而连接流程正卡在 await 上（例如 `ensureAuthenticated` 里的 waitForSelector）。
 * 页面被拆/会话被拆时，等待中的选择器会以 "Target page has been closed" 抛错——
 * **这是用户意图的结果，不是连接失败**。
 *
 * 旧实现把它当成 attach 失败 → 降级回退外部浏览器 → 用户看到「已回退外部浏览器登录」。
 * 根因是「连接阶段的错误没有分类契约」，本类就是那份契约的载体。
 *
 * `kind` 由关闭来源决定（见 ConnectionFailureKind 文档）：
 * - `closeReason='user' | 'internal'` → kind='aborted'（静默，不打扰用户）
 * - `closeReason='page-closed'` → kind='page-closed'（页面被外部关闭，要通知）
 */
export class ConnectionAbortedError extends Error {
  readonly kind: ConnectionFailureKind

  constructor(
    readonly connectId: string,
    readonly closeReason: SessionCloseReason,
    cause?: unknown,
  ) {
    super(`连接已中止（connectId=${connectId}，来源=${closeReason}）`)
    this.name = 'ConnectionAbortedError'
    this.kind = closeReason === 'page-closed' ? 'page-closed' : 'aborted'
    if (cause !== undefined) this.cause = cause
  }
}
