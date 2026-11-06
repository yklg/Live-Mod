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

  // guangquan-shell-ui-parity v3 · P1-5 迁移：rail 入口豁免（view=rail 与 panel 双值兼容期）
  it('TC-M4 [rail 豁免] view=rail search 与 hash 两态均 true；panel 兼容期不回归', () => {
    expect(isPanelMode('?view=rail', '')).toBe(true)
    expect(isPanelMode('', '#/auto-popup?view=rail')).toBe(true)
    expect(isPanelMode('?view=panel', '')).toBe(true)
    expect(isPanelMode('?view=chrome', '')).toBe(false) // chrome 入口不豁免（无业务页）
    expect(isPanelMode('?view=other', '')).toBe(false)
  })
})
