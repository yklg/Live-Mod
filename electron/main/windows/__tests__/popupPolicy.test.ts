import { describe, expect, it } from 'vitest'
import { classifyPopup } from '#/windows/popupPolicy'

// ===== 弹窗三段决策（seamless-fix v3 · A1，G1/G2 覆盖）=====
// 守护不变量：
//   I16 分类只看 host+path（query 忽略、大小写/尾斜杠归一、port 参与 host 比较）
//   I17 view 承载体业务弹窗=fold、异 host=external；window 承载体保持 allow（Phase 1 行为锚，防误统一）
//   I18 任何无法分类的输入（畸形/blank 当前页）归最保守档 deny-selfdup（纯拒绝，不 fold 不外开）
const V = (currentUrl: string, popupUrl: string) =>
  classifyPopup({ currentUrl, popupUrl, carrier: 'view' })
const W = (currentUrl: string, popupUrl: string) =>
  classifyPopup({ currentUrl, popupUrl, carrier: 'window' })

describe('classifyPopup 三段决策（TC-PP1~PP10）', () => {
  it('TC-PP1 同 host+同 path = 自复制逃逸 → deny-selfdup', () => {
    const cur = 'https://fxg.jinritemai.com/login/common?extra=a'
    const pop = 'https://fxg.jinritemai.com/login/common?extra=b'
    expect(V(cur, pop)).toBe('deny-selfdup')
    expect(W(cur, pop)).toBe('deny-selfdup')
  })

  it('TC-PP2 同 host 异 path + view → fold', () => {
    expect(
      V(
        'https://buyin.jinritemai.com/dashboard/live',
        'https://buyin.jinritemai.com/mpa/account/login',
      ),
    ).toBe('fold')
  })

  it('TC-PP3 同 host 异 path + window → allow（Phase 1 防回归锚）', () => {
    expect(
      W(
        'https://buyin.jinritemai.com/dashboard/live',
        'https://buyin.jinritemai.com/mpa/account/login',
      ),
    ).toBe('allow')
  })

  it('TC-PP4 异 host + view → external', () => {
    expect(V('https://fxg.jinritemai.com/ffa/x', 'https://www.douyin.com/help')).toBe('external')
  })

  it('TC-PP5 异 host + window → allow（launched 内新 tab，适配器无感）', () => {
    expect(W('https://fxg.jinritemai.com/ffa/x', 'https://www.douyin.com/help')).toBe('allow')
  })

  it('TC-PP6 畸形输入归最保守档', () => {
    expect(V('not-a-url', 'https://a.com/b')).toBe('deny-selfdup')
    expect(V('https://a.com/b', '%%%')).toBe('deny-selfdup')
  })

  it('TC-PP7 当前页 about:blank#nonce 阶段弹窗不误 fold', () => {
    expect(V('about:blank#lm-nonce-a1-u1', 'https://fxg.jinritemai.com/login/common')).toBe(
      'deny-selfdup',
    )
  })

  it('TC-PP8 归一化：host 大小写/尾斜杠/port', () => {
    expect(
      V('https://FXG.Jinritemai.com/login/common', 'https://fxg.jinritemai.com/login/common/'),
    ).toBe('deny-selfdup')
    expect(V('https://a.com:443/p', 'https://a.com/p')).toBe('deny-selfdup')
    expect(V('https://a.com:8443/p', 'https://a.com/p')).toBe('external')
  })

  it('TC-PP9 pathname 前缀相似不算同 path', () => {
    expect(V('https://a.com/login', 'https://a.com/login-x')).toBe('fold')
  })

  it('TC-PP10 query/hash 不参与分类', () => {
    expect(V('https://a.com/p?x=1#h', 'https://a.com/p?y=2')).toBe('deny-selfdup')
  })
})
