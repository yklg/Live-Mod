import { describe, expect, it } from 'vitest'
import { classifyPopup } from '#/windows/popupPolicy'

// ===== 弹窗决策（fix-shell-popup-navigation-liveend Phase 2 重构）=====
// 守护不变量：
//   I16 分类只看 host+path（query 忽略、大小写/尾斜杠归一、port 参与 host 比较）
//   I17 view 承载体业务弹窗=**new-tab**（浏览器语义，壳层新 Tab 承载；不再 fold 劫持当前页）、
//       异 host=external；window 承载体保持 allow（Phase 1 行为锚，防误统一）
//   I18 任何无法分类的输入（畸形/blank 当前页）归最保守档 deny-selfdup（纯拒绝，不 fold 不外开）
//   I19 登录等「同页折叠」旧语义不再由本决策层表达——由会话层经 windows/popupIntent 显式声明，
//       决策层保持平台无关（A5 边界）
const V = (currentUrl: string, popupUrl: string) =>
  classifyPopup({ currentUrl, popupUrl, carrier: 'view' })
const W = (currentUrl: string, popupUrl: string) =>
  classifyPopup({ currentUrl, popupUrl, carrier: 'window' })

describe('classifyPopup 决策表（TC-PP1~PP10）', () => {
  it('TC-PP1 同 host+同 path = 自复制逃逸 → deny-selfdup', () => {
    const cur = 'https://fxg.jinritemai.com/login/common?extra=a'
    const pop = 'https://fxg.jinritemai.com/login/common?extra=b'
    expect(V(cur, pop)).toBe('deny-selfdup')
    expect(W(cur, pop)).toBe('deny-selfdup')
  })

  it('TC-PP2 同 host 异 path + view → new-tab（浏览器语义，不劫持会话页）', () => {
    expect(
      V(
        'https://buyin.jinritemai.com/dashboard/live',
        'https://buyin.jinritemai.com/mpa/account/login',
      ),
    ).toBe('new-tab')
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

  it('TC-PP7 当前页 about:blank#nonce 阶段弹窗不误分类', () => {
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
    expect(V('https://a.com/login', 'https://a.com/login-x')).toBe('new-tab')
  })

  it('TC-PP10 query/hash 不参与分类', () => {
    expect(V('https://a.com/p?x=1#h', 'https://a.com/p?y=2')).toBe('deny-selfdup')
  })
})

// 壳内登录 v1（真实缺陷回归）：百应登录链路跨域 douyinec.com ↔ buyin.jinritemai.com，
// 旧策略把跨域弹窗判为 external → attach 登录页逃逸到系统浏览器（入口选百应即复现）。
// 修复：平台层注入 ownedOrigins，受信域后缀命中 → 壳内承载；未注入时保持原有 external 语义。
// Phase 2：承载方式由 fold（劫持当前页）改为 new-tab（壳层新 Tab），登录窗口期的同页折叠由会话层意图声明。
describe('classifyPopup 跨域可信域（TC-PP11~PP14）', () => {
  const owned = ['jinritemai.com', 'douyinec.com'] as const
  const VO = (currentUrl: string, popupUrl: string, origins: readonly string[] = owned) =>
    classifyPopup({ currentUrl, popupUrl, carrier: 'view', ownedOrigins: origins })

  it('TC-PP11 跨域但属平台可信域 → new-tab（百应 douyinec → buyin 登录页）', () => {
    expect(
      VO(
        'https://www.douyinec.com/',
        'https://buyin.jinritemai.com/mpa/account/login?log_out=1&type=24',
      ),
    ).toBe('new-tab')
  })

  it('TC-PP12 未注入 ownedOrigins → 仍 external（launched/其它路径零行为变化）', () => {
    expect(V('https://www.douyinec.com/', 'https://buyin.jinritemai.com/mpa/account/login')).toBe(
      'external',
    )
  })

  it('TC-PP13 后缀匹配必须带点边界：eviljinritemai.com ≠ 受信域', () => {
    expect(VO('https://www.douyinec.com/', 'https://eviljinritemai.com/login')).toBe('external')
    expect(VO('https://www.douyinec.com/', 'https://sub.buyin.jinritemai.com/x')).toBe('new-tab')
  })

  it('TC-PP14 window 承载体不受 ownedOrigins 影响（恒 allow，Phase 1 行为锚）', () => {
    expect(
      classifyPopup({
        currentUrl: 'https://www.douyinec.com/',
        popupUrl: 'https://buyin.jinritemai.com/mpa/account/login',
        carrier: 'window',
        ownedOrigins: owned,
      }),
    ).toBe('allow')
  })
})
