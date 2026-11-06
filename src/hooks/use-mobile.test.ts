import { describe, expect, it } from 'vitest'
import { isPanelMode } from './use-mobile'

// ===== panel 模式判定（seamless-fix v3 · B.2，G4 覆盖）=====
// 契约：?view=panel（search 或 hash 路由内）→ true；useIsMobile 在 panel 模式恒 false
describe('isPanelMode（TC-M1~M3）', () => {
  it('TC-M1 search 参数 view=panel → true', () => {
    expect(isPanelMode('?view=panel', '')).toBe(true)
  })

  it('TC-M2 无参数 → false（经典模式零变化）', () => {
    expect(isPanelMode('', '')).toBe(false)
    expect(isPanelMode('?view=classic', '')).toBe(false)
  })

  it('TC-M3 hash 路由内参数仍可读（#/settings?view=panel）', () => {
    expect(isPanelMode('', '#/settings?view=panel')).toBe(true)
  })
})
