import { describe, expect, it } from 'vitest'
import { isAllowedPageNavigation } from '#/windows/externalProtocolGuard'

// ===== 外部协议导航守卫（壳入口 v1 验证期实证）=====
// 现象复现：百应中控台页面 JS 触发 bytedance://dispatch_message/ → macOS 弹「未设定用来打开 URL 的应用程序」。
// 契约：页面导航只允许 http(s)/about/data/blob；其余协议一律拦截（file:/mailto:/自定义 scheme）。
describe('isAllowedPageNavigation（TC-EP1~EP4）', () => {
  it('TC-EP1 正常网页协议放行', () => {
    expect(isAllowedPageNavigation('https://buyin.jinritemai.com/dashboard/live/control')).toBe(
      true,
    )
    expect(isAllowedPageNavigation('http://127.0.0.1:8080/a?b=1')).toBe(true)
    expect(isAllowedPageNavigation('about:blank')).toBe(true)
    expect(isAllowedPageNavigation('data:text/html,hi')).toBe(true)
    expect(isAllowedPageNavigation('blob:https://a.com/uuid')).toBe(true)
  })

  it('TC-EP2 外部协议深链拦截（真实复现路径）', () => {
    expect(isAllowedPageNavigation('bytedance://dispatch_message/')).toBe(false)
    expect(isAllowedPageNavigation('bytedance://dispatch_message/?a=1')).toBe(false)
    expect(isAllowedPageNavigation('mailto:hi@example.com')).toBe(false)
    expect(isAllowedPageNavigation('weixin://dl/chat')).toBe(false)
    expect(isAllowedPageNavigation('tel:10086')).toBe(false)
  })

  it('TC-EP3 本地 file 协议对远程官方页拒绝（安全边界）', () => {
    expect(isAllowedPageNavigation('file:///etc/passwd')).toBe(false)
    expect(isAllowedPageNavigation('file:///Users/x/a.html')).toBe(false)
  })

  it('TC-EP4 畸形/空 URL 归不允许（保守口径，不裸抛）', () => {
    expect(isAllowedPageNavigation('')).toBe(false)
    expect(isAllowedPageNavigation('not a url')).toBe(false)
    expect(isAllowedPageNavigation('javascript:void(0)')).toBe(false)
  })
})
