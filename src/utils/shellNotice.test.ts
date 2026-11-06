import { describe, expect, it } from 'vitest'
import { shouldRouteToastToNotice } from '@/utils/shellNotice'

// ===== 壳模式 toast 路由判定（shell-ui-polish v3 · TC-RT-01）=====
// 契约：只有壳 UI 的 rail 业务树路由到通知覆盖层；chrome/entry/notice 最小树、经典 index、缺省一律本地。
describe('shouldRouteToastToNotice（TC-RT-01）', () => {
  it('TC-RT-01a rail + 壳 UI → 路由', () => {
    expect(shouldRouteToastToNotice({ name: 'rail', shellUi: true })).toBe(true)
  })

  it('TC-RT-01b 其它壳视图 → 不路由（最小树不发业务 toast）', () => {
    for (const name of ['chrome', 'entry', 'notice'] as const) {
      expect(shouldRouteToastToNotice({ name, shellUi: true })).toBe(false)
    }
  })

  it('TC-RT-01c 经典 index / 缺省 / shellUi=false → 不路由（本地 Toaster 零变化）', () => {
    expect(shouldRouteToastToNotice({ name: 'index', shellUi: false })).toBe(false)
    expect(shouldRouteToastToNotice(undefined)).toBe(false)
    expect(shouldRouteToastToNotice(null)).toBe(false)
    expect(shouldRouteToastToNotice({ name: 'rail', shellUi: false })).toBe(false)
  })
})
