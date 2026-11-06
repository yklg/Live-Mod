import { describe, expect, it } from 'vitest'
import { isShellPanelView } from '@/shell/lib/panelMode'

// ===== 面板模式判定（计划 v3 · C3/C4/C6 只作用于壳面板，经典保持原状）=====
describe('isShellPanelView（panelMode）', () => {
  it('壳面板（rail）：返回 true', () => {
    expect(isShellPanelView({ name: 'rail', shellUi: true })).toBe(true)
  })

  it('经典入口 index：返回 false', () => {
    expect(isShellPanelView({ name: 'index', shellUi: false })).toBe(false)
  })

  it('缺失/其它壳视图：保守 false（不折叠经典内容）', () => {
    expect(isShellPanelView(undefined)).toBe(false)
    for (const name of ['chrome', 'entry', 'notice'] as const) {
      expect(isShellPanelView({ name, shellUi: true })).toBe(false)
    }
  })
})
