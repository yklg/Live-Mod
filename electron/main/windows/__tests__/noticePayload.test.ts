import { describe, expect, it } from 'vitest'
import {
  NOTICE_DESC_MAX,
  NOTICE_TITLE_MAX,
  NOTICE_VARIANTS,
  validateNoticePayload,
} from '#/windows/noticePayload'

// ===== 通知 payload 运行时校验（shell-ui-polish v3 · TC-NP-01~04，IPC 边界）=====
// 契约：四变体白名单；description 必填/非空/≤200（trim 后）；title 可选 ≤60；非法一律拒绝不抛。
describe('validateNoticePayload（TC-NP-01~04）', () => {
  it('TC-NP-01 四变体合法 payload 通过并规范化（去首尾空格/无 title 不落键）', () => {
    for (const variant of NOTICE_VARIANTS) {
      const r = validateNoticePayload({ variant, description: '  已连接直播控制台  ' })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.payload).toEqual({ variant, description: '已连接直播控制台' })
      expect('title' in r.payload).toBe(false)
    }
  })

  it('TC-NP-02 非法类型/非法变体/缺描述/空描述 → 拒绝且不抛', () => {
    expect(validateNoticePayload(null)).toMatchObject({ ok: false, reason: 'invalid-type' })
    expect(validateNoticePayload('x')).toMatchObject({ ok: false, reason: 'invalid-type' })
    expect(validateNoticePayload({ variant: 'fatal', description: 'x' })).toMatchObject({
      ok: false,
      reason: 'invalid-variant',
    })
    expect(validateNoticePayload({ description: 'x' })).toMatchObject({
      ok: false,
      reason: 'invalid-variant',
    })
    expect(validateNoticePayload({ variant: 'error' })).toMatchObject({
      ok: false,
      reason: 'missing-description',
    })
    expect(validateNoticePayload({ variant: 'error', description: 42 })).toMatchObject({
      ok: false,
      reason: 'missing-description',
    })
    expect(validateNoticePayload({ variant: 'error', description: '   ' })).toMatchObject({
      ok: false,
      reason: 'empty-description',
    })
    expect(validateNoticePayload({ variant: 'error', description: 'x', title: 42 })).toMatchObject({
      ok: false,
      reason: 'invalid-type',
    })
  })

  it('TC-NP-03 长度边界：description 200/201、title 60/61（trim 后计长）', () => {
    const descOk = validateNoticePayload({
      variant: 'error',
      description: 'a'.repeat(NOTICE_DESC_MAX),
    })
    expect(descOk.ok).toBe(true)
    expect(
      validateNoticePayload({ variant: 'error', description: 'a'.repeat(NOTICE_DESC_MAX + 1) }),
    ).toMatchObject({ ok: false, reason: 'description-too-long' })
    expect(
      validateNoticePayload({
        variant: 'info',
        title: 'b'.repeat(NOTICE_TITLE_MAX),
        description: 'x',
      }).ok,
    ).toBe(true)
    expect(
      validateNoticePayload({
        variant: 'info',
        title: 'b'.repeat(NOTICE_TITLE_MAX + 1),
        description: 'x',
      }),
    ).toMatchObject({ ok: false, reason: 'title-too-long' })
    // trim 后恰好 200 通过（边界口径）
    expect(
      validateNoticePayload({
        variant: 'success',
        description: `  ${'a'.repeat(NOTICE_DESC_MAX)}  `,
      }).ok,
    ).toBe(true)
  })

  it('TC-NP-04 CJK/emoji 计入长度且合法保留原字符', () => {
    const text = '壳内连接失败 😀 已回退外部浏览器登录'
    const r = validateNoticePayload({ variant: 'error', description: text })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.description).toBe(text)
    expect(
      validateNoticePayload({ variant: 'error', description: '汉'.repeat(NOTICE_DESC_MAX + 5) }).ok,
    ).toBe(false)
  })
})
