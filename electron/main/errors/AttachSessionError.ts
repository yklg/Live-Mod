import type { ConnectionFailureKind } from './connectionError'

/**
 * attach 会话建立失败的可判别错误。
 *
 * 壳 v3 · Wave 1：原本这个类定义在 managers/BrowserSessionManager.ts，
 * 那里同时挂着 playwright / electron 重量依赖，导致它无法被独立测试。
 * 错误类归 errors/ 目录是本仓既有约定（AppError.ts / PlatformError.ts），
 * 这里只是把它搬到正确的位置，**行为与语义不变**。
 *
 * reason 是 attach 专属的子原因；kind 是连接失败判别式（供 ipc 层分流，无需 instanceof 多分支）。
 */
export class AttachSessionError extends Error {
  constructor(
    readonly reason: 'cdp-endpoint' | 'nonce-timeout' | 'connect-failed',
    message: string,
  ) {
    super(message)
    this.name = 'AttachSessionError'
  }

  /**
   * 连接失败判别式：
   * - `nonce-timeout`：等不到 nonce 探测 → 归 timeout（等待超时，语义更准）
   * - 其余（cdp-endpoint / connect-failed）：attach 专属失败
   */
  get kind(): ConnectionFailureKind {
    return this.reason === 'nonce-timeout' ? 'timeout' : 'attach'
  }
}
