/**
 * 连接失败判别式（壳 v3 · Wave 1 · P0-1）。
 *
 * 为什么用 `kind` 而不是 `instanceof` 多分支：判别式挂在错误对象上，
 * 新增一类失败只要让错误带上新的 kind，ipc/connection.ts 的分支结构不必改（生长性）。
 *
 * 语义边界（与计划 §9-1/§9-3 一一对应）：
 * - `aborted`：**用户主动断开 / 主动重启连接**。不是失败，全程静默——不弹 toast、不推通知。
 * - `page-closed`：会话页面被外部关闭。与 `aborted` 是**两类，不得混淆**——前者要通知用户，
 *   后者不该打扰。
 * - `attach`：attach 形态建立会话失败（CDP 端点不可达 / connectOverCDP 失败）。
 * - `timeout`：等待超时（nonce 探测超时 / Playwright TimeoutError）。
 * - `other`：以上都不是的失败（归约兜底）。
 */
export type ConnectionFailureKind = 'aborted' | 'attach' | 'page-closed' | 'timeout' | 'other'

/** 会话关闭来源：决定连接失败是被归约为 `aborted` 还是 `page-closed` */
export type SessionCloseReason = 'user' | 'page-closed' | 'internal'

const KINDS: readonly ConnectionFailureKind[] = [
  'aborted',
  'attach',
  'page-closed',
  'timeout',
  'other',
]

function isFailureKind(value: unknown): value is ConnectionFailureKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

/**
 * 从任意错误取出连接失败判别式。
 *
 * 优先级：错误对象自带的 `kind` → 已知错误形态（AttachSessionError / TimeoutError）→ `other`。
 * 这里只做**一次**归一，调用方（ipc/connection.ts）拿到的永远是判别式，
 * 不需要知道自己面对的是哪种 Error 子类。
 */
export function connectionFailureKind(error: unknown): ConnectionFailureKind {
  const kind = (error as { kind?: unknown } | null | undefined)?.kind
  if (isFailureKind(kind)) return kind

  // AttachSessionError：nonce 探测超时归 timeout，其余归 attach
  const reason = (error as { reason?: unknown } | null | undefined)?.reason
  if (reason === 'nonce-timeout') return 'timeout'
  if (reason === 'cdp-endpoint' || reason === 'connect-failed') return 'attach'

  // Playwright 超时（TimeoutError）
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout'

  return 'other'
}

/** 取失败原因的可读文本（用于通知文案与结构化日志） */
export function connectionFailureReason(error: unknown): string {
  if (error instanceof Error) {
    const detail = (error as { reason?: unknown }).reason
    if (typeof detail === 'string' && detail) return `${detail}: ${error.message}`
    return error.message || error.name
  }
  if (typeof error === 'string' && error) return error
  return String(error ?? '未知错误')
}
