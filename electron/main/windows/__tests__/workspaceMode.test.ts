import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceMode, isWorkspaceMode } from '#/windows/workspaceMode'

describe('workspaceMode 状态机', () => {
  it('默认 workbench；三态全迁移', () => {
    const changes: string[] = []
    const m = createWorkspaceMode('workbench', next => changes.push(next))
    expect(m.mode()).toBe('workbench')
    expect(m.enterLive()).toBe(true)
    expect(m.enterBrowse()).toBe(true)
    expect(m.enterWorkbench()).toBe(true)
    expect(changes).toEqual(['live', 'browse', 'workbench'])
  })

  it('同态 set 返回 false，不触发 onChange', () => {
    const onChange = vi.fn()
    const m = createWorkspaceMode('live', onChange)
    expect(m.set('live')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('非法值拒绝且保持原态', () => {
    const m = createWorkspaceMode('live')
    expect(m.set('dock' as never)).toBe(false)
    expect(m.mode()).toBe('live')
    expect(isWorkspaceMode('workbench')).toBe(true)
    expect(isWorkspaceMode('nope')).toBe(false)
  })

  it('live→browse→live 不丢状态（纯状态机无副作用）', () => {
    const m = createWorkspaceMode('live')
    m.enterBrowse()
    m.enterLive()
    expect(m.mode()).toBe('live')
  })
})
