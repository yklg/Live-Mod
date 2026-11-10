import { describe, expect, it } from 'vitest'
import { createPanelController } from '#/windows/panelController'
import type { ShellBounds, ShellMode } from '#/windows/shellLayout'

function setup(opts?: {
  winW?: number
  winH?: number
  hasActiveTab?: boolean
  dockWidth?: number
  mode?: ShellMode
}) {
  const size = { w: opts?.winW ?? 1440, h: opts?.winH ?? 800 }
  const applied: ShellBounds[] = []
  const pushed: Array<{ panelOpen: boolean; routeId: string | null }> = []
  const ctrl = createPanelController({
    winSize: () => ({ ...size }),
    hasActiveTab: () => opts?.hasActiveTab ?? true,
    mode: () => opts?.mode ?? 'live',
    dockWidth: () => opts?.dockWidth ?? 360,
    applyBounds: b => applied.push(b),
    pushRail: s => pushed.push(s),
  })
  return { size, ctrl, applied, pushed }
}

describe('panelController 开合决策表', () => {
  it('toggle(popup) → open，推送与 dock bounds 同步', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('popup')
    expect(f.pushed.at(-1)).toEqual({ panelOpen: true, routeId: 'popup' })
    expect(f.applied.at(-1)?.rail.width).toBe(416)
    expect(f.applied.at(-1)?.page?.width).toBe(1440 - 360 - 56)
  })

  it('同 route 再 toggle → close；异 route → 保持打开换页', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    f.ctrl.toggle('popup')
    expect(f.ctrl.isOpen()).toBe(false)
    expect(f.pushed.at(-1)).toEqual({ panelOpen: false, routeId: null })
    f.ctrl.toggle('popup')
    f.ctrl.toggle('message')
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('message')
  })

  it('open(route) 可原子打开指定 route，close 幂等', () => {
    const f = setup()
    f.ctrl.open('settings')
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('settings')
    f.ctrl.close()
    f.ctrl.close()
    expect(f.ctrl.isOpen()).toBe(false)
  })

  it('1024 + 360：overlay 下 page bounds 与收起态相同', () => {
    const closed = setup({ winW: 1024, winH: 720 })
    const open = setup({ winW: 1024, winH: 720 })
    closed.ctrl.close()
    open.ctrl.open('popup')
    expect(open.applied.at(-1)?.page).toEqual(closed.applied.at(-1)?.page)
    expect(open.applied.at(-1)?.page?.width).toBe(1024 - 56)
    expect(open.pushed.at(-1)?.panelOpen).toBe(true)
  })

  it('resize 只重算不翻态；无 active Tab 时 page=null', () => {
    const f = setup({ hasActiveTab: false })
    f.ctrl.open('popup')
    expect(f.applied.at(-1)?.page).toBeNull()
    f.size.w = 1024
    f.ctrl.resize()
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.pushed.at(-1)?.panelOpen).toBe(true)
  })

  it('entry 下 dockOpen 不生效（page=null）', () => {
    const f = setup({ mode: 'entry' })
    f.ctrl.open('popup')
    expect(f.applied.at(-1)?.page).toBeNull()
    expect(f.applied.at(-1)?.rail.width).toBe(56)
  })
})
