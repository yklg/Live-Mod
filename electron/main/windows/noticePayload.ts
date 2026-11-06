// 壳级通知 payload 运行时校验（IPC 边界，shell-ui-polish v3 · EX-B 外部经验）
// 类型契约在 shared/types.d.ts（NoticePayload）；本模块负责**运行时**白名单校验：
// 非法变体/缺描述/空描述/超长一律拒绝（丢弃 + 由调用方记日志），不重试、不猜测。
export const NOTICE_VARIANTS: readonly NoticeVariant[] = ['success', 'error', 'warning', 'info']
export const NOTICE_DESC_MAX = 200
export const NOTICE_TITLE_MAX = 60

export type NoticePayloadFailure =
  | 'invalid-type'
  | 'invalid-variant'
  | 'missing-description'
  | 'empty-description'
  | 'description-too-long'
  | 'title-too-long'

export type NoticePayloadResult =
  | { ok: true; payload: NoticePayload }
  | { ok: false; reason: NoticePayloadFailure }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function validateNoticePayload(input: unknown): NoticePayloadResult {
  if (!isRecord(input)) return { ok: false, reason: 'invalid-type' }
  const rawVariant = input.variant
  if (
    typeof rawVariant !== 'string' ||
    !(NOTICE_VARIANTS as readonly string[]).includes(rawVariant)
  ) {
    return { ok: false, reason: 'invalid-variant' }
  }
  const rawDescription = input.description
  if (typeof rawDescription !== 'string') return { ok: false, reason: 'missing-description' }
  const description = rawDescription.trim()
  if (description.length === 0) return { ok: false, reason: 'empty-description' }
  if (description.length > NOTICE_DESC_MAX) return { ok: false, reason: 'description-too-long' }

  const rawTitle = input.title
  if (rawTitle !== undefined && typeof rawTitle !== 'string') {
    return { ok: false, reason: 'invalid-type' }
  }
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (title.length > NOTICE_TITLE_MAX) return { ok: false, reason: 'title-too-long' }

  // 长度按 trim 后字符数（CJK/emoji 按 JS 码元计——与 UI 截断口径一致）
  return {
    ok: true,
    payload: {
      variant: rawVariant as NoticeVariant,
      description,
      ...(title ? { title } : {}),
    },
  }
}
