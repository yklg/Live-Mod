import { describe, expect, it } from 'vitest'
import {
  normalizePopupUrl,
  type PendingPopupNav,
  resolvePopupOpenAction,
  shouldSuppressFallbackNavigation,
} from '#/windows/popupAction'

// ===== 弹窗打开动作纯决策（fix-shell-popup-navigation-liveend · v2 焦点契约/门控）=====
// 守护不变量：
//   P1 自复制弹窗永远 deny（反嵌入逃逸），不受 intent/openerActive 影响
//   P2 view 档出现 allow（不应发生）→ deny（防御，不打开任何窗口）
//   P3 外链 → external（系统浏览器）
//   P4 登录窗口期 intent-navigate 优先于 openerActive（折叠当前页，不新 Tab）
//   P5 其余业务弹窗 → new-tab；openerActive 决定前台(true)/后台(false)（v2 焦点门控）
//   P6 兜底导航抑制只拦「已承载 URL + 未过期」，绝不误伤其它导航
const A = (input: Parameters<typeof resolvePopupOpenAction>[0]) => resolvePopupOpenAction(input)

describe('resolvePopupOpenAction 决策表（TC-PA1~PA6）', () => {
  it('TC-PA1 自复制 → deny（无视 intent/openerActive）', () => {
    expect(A({ decision: 'deny-selfdup', intentMode: null, openerActive: true })).toEqual({
      kind: 'deny',
      activate: false,
      reason: 'deny-selfdup',
    })
    expect(A({ decision: 'deny-selfdup', intentMode: 'navigate', openerActive: true }).kind).toBe(
      'deny',
    )
  })

  it('TC-PA2 view 档异常 allow → deny（防御分支，不打开窗口）', () => {
    expect(A({ decision: 'allow', intentMode: null, openerActive: true })).toEqual({
      kind: 'deny',
      activate: false,
      reason: 'unexpected-allow',
    })
  })

  it('TC-PA3 外链 → external', () => {
    expect(A({ decision: 'external', intentMode: null, openerActive: true })).toEqual({
      kind: 'external',
      activate: false,
      reason: 'external',
    })
  })

  it('TC-PA4 登录窗口期 navigate 意图 → 折叠当前页（优先于 openerActive）', () => {
    const active = A({ decision: 'new-tab', intentMode: 'navigate', openerActive: true })
    const inactive = A({ decision: 'new-tab', intentMode: 'navigate', openerActive: false })
    expect(active).toEqual({ kind: 'navigate', activate: false, reason: 'intent-navigate' })
    expect(inactive).toEqual({ kind: 'navigate', activate: false, reason: 'intent-navigate' })
  })

  it('TC-PA5 业务弹窗：opener active → 前台聚焦；opener 非 active → 后台（不抢焦点）', () => {
    expect(A({ decision: 'new-tab', intentMode: null, openerActive: true })).toEqual({
      kind: 'new-tab',
      activate: true,
      reason: 'new-tab-foreground',
    })
    expect(A({ decision: 'new-tab', intentMode: null, openerActive: false })).toEqual({
      kind: 'new-tab',
      activate: false,
      reason: 'new-tab-background',
    })
  })

  it('TC-PA6 决策为纯函数（同输入同输出，无隐藏状态）', () => {
    const input = { decision: 'new-tab' as const, intentMode: null, openerActive: true }
    expect(A(input)).toEqual(A(input))
  })
})

describe('shouldSuppressFallbackNavigation（TC-PA7~PA11）', () => {
  const now = 1_000_000
  const pending: PendingPopupNav = { url: 'https://a.com/x?q=1#h', expiresAt: now + 5000 }

  it('TC-PA7 无待处理弹窗 → 不抑制', () => {
    expect(shouldSuppressFallbackNavigation(null, 'https://a.com/x', now)).toBe(false)
  })

  it('TC-PA8 URL 命中且未过期 → 抑制（hash 不参与比较）', () => {
    expect(shouldSuppressFallbackNavigation(pending, 'https://a.com/x?q=1', now)).toBe(true)
    expect(shouldSuppressFallbackNavigation(pending, 'https://a.com/x?q=1#different', now)).toBe(
      true,
    )
  })

  it('TC-PA9 已过期 → 不抑制', () => {
    expect(shouldSuppressFallbackNavigation(pending, 'https://a.com/x?q=1', now + 5001)).toBe(false)
    expect(shouldSuppressFallbackNavigation(pending, 'https://a.com/x?q=1', now + 5000)).toBe(true)
  })

  it('TC-PA10 不同 URL（path/query/origin）→ 不抑制，绝不误伤用户导航', () => {
    expect(shouldSuppressFallbackNavigation(pending, 'https://a.com/y?q=1', now)).toBe(false)
    expect(shouldSuppressFallbackNavigation(pending, 'https://a.com/x?q=2', now)).toBe(false)
    expect(shouldSuppressFallbackNavigation(pending, 'https://b.com/x?q=1', now)).toBe(false)
  })

  it('TC-PA11 非法 URL 原样比较（保守：不猜测、不匹配）', () => {
    const bad: PendingPopupNav = { url: 'not-a-url', expiresAt: now + 5000 }
    expect(shouldSuppressFallbackNavigation(bad, 'not-a-url', now)).toBe(true)
    expect(shouldSuppressFallbackNavigation(bad, 'https://a.com/x', now)).toBe(false)
    expect(normalizePopupUrl('not-a-url')).toBe('not-a-url')
  })
})
