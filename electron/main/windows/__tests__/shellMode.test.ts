import { describe, expect, it } from 'vitest'
import { createShellMode, isShellMode } from '#/windows/shellMode'

describe('shellMode 状态机', () => {
  it('默认 entry；entry/live/browse 三态迁移', () => {
    const changes: string[] = []
    const m = createShellMode('entry', next => changes.push(next))
    expect(m.mode()).toBe('entry')
    expect(m.set('live')).toBe(true)
    expect(m.set('browse')).toBe(true)
    expect(m.set('entry')).toBe(true)
    expect(changes).toEqual(['live', 'browse', 'entry'])
  })

  it('同值 set 幂等且不触发 onChange', () => {
    const changes: string[] = []
    const m = createShellMode('entry', next => changes.push(next))
    expect(m.set('entry')).toBe(true)
    expect(changes).toEqual([])
  })

  it('非法值拒绝且不改变当前模式', () => {
    const m = createShellMode('entry')
    expect(m.set('workbench' as never)).toBe(false)
    expect(m.mode()).toBe('entry')
  })

  it('isShellMode 词表', () => {
    expect(isShellMode('entry')).toBe(true)
    expect(isShellMode('live')).toBe(true)
    expect(isShellMode('browse')).toBe(true)
    expect(isShellMode('workbench')).toBe(false)
    expect(isShellMode('')).toBe(false)
  })
})
