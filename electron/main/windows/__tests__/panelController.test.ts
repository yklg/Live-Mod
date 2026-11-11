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
    expect(f.pushed.at(-1)).toEqual({ panelOpen: true, routeId: 'popup', menuOpen: false })
    // 壳 v3 · Wave 2：图标条删除 → rail 宽度就是 dock 宽度；overlay 下 page 满宽不变
    expect(f.applied.at(-1)?.rail.width).toBe(360)
    expect(f.applied.at(-1)?.page?.width).toBe(1440)
  })

  it('同 route 再 toggle → close；异 route → 保持打开换页', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    f.ctrl.toggle('popup')
    expect(f.ctrl.isOpen()).toBe(false)
    expect(f.pushed.at(-1)).toEqual({ panelOpen: false, routeId: null, menuOpen: false })
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

  it('1024 + 360：overlay 下 page 满宽不变（面板浮在右侧，不挤占官方页）', () => {
    const closed = setup({ winW: 1024, winH: 720 })
    const open = setup({ winW: 1024, winH: 720 })
    closed.ctrl.close()
    open.ctrl.open('popup')
    expect(open.applied.at(-1)?.page).toEqual(closed.applied.at(-1)?.page)
    expect(open.applied.at(-1)?.page?.width).toBe(1024)
    expect(open.applied.at(-1)?.rail.width).toBe(360)
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

  it('entry 下 dockOpen 不生效（page=null，rail 宽度归零）', () => {
    const f = setup({ mode: 'entry' })
    f.ctrl.open('popup')
    expect(f.applied.at(-1)?.page).toBeNull()
    expect(f.applied.at(-1)?.rail.width).toBe(0)
  })
})

describe('顶栏悬浮菜单状态机（壳 v3 · Wave 3）', () => {
  it('开菜单 → 面板让位、菜单开、rail 232', () => {
    const f = setup()
    f.ctrl.openMenu()
    expect(f.ctrl.isMenuOpen()).toBe(true)
    expect(f.ctrl.isOpen()).toBe(false)
    expect(f.pushed.at(-1)).toEqual({ panelOpen: false, routeId: null, menuOpen: true })
    expect(f.applied.at(-1)?.rail.width).toBe(232)
  })

  it('选中项 → 菜单关 + 面板开（选中项）', () => {
    const f = setup()
    f.ctrl.openMenu()
    f.ctrl.selectMenu('settings')
    expect(f.ctrl.isMenuOpen()).toBe(false)
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('settings')
    expect(f.pushed.at(-1)).toEqual({ panelOpen: true, routeId: 'settings', menuOpen: false })
  })

  it('再点/ESC → 菜单关，并恢复开菜单前的面板态', () => {
    const f = setup()
    // 从「面板打开在某 route」进入菜单 → 关闭菜单后应原样恢复
    f.ctrl.open('popup')
    f.ctrl.openMenu()
    expect(f.ctrl.isOpen()).toBe(false)
    f.ctrl.closeMenu()
    expect(f.ctrl.isMenuOpen()).toBe(false)
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('popup')
  })

  it('从收起态进入菜单 → 关闭菜单后保持收起（不凭空开面板）', () => {
    const f = setup()
    f.ctrl.openMenu()
    f.ctrl.closeMenu()
    expect(f.ctrl.isMenuOpen()).toBe(false)
    expect(f.ctrl.isOpen()).toBe(false)
    expect(f.ctrl.route()).toBeNull()
  })

  it('toggleMenu 幂等切换；面板入口在菜单开着时不另开面板', () => {
    const f = setup()
    f.ctrl.toggleMenu()
    expect(f.ctrl.isMenuOpen()).toBe(true)
    f.ctrl.toggleMenu()
    expect(f.ctrl.isMenuOpen()).toBe(false)
    f.ctrl.openMenu()
    f.ctrl.toggle('popup')
    // 菜单优先：面板入口被菜单接管，菜单关闭后恢复原态
    expect(f.ctrl.isMenuOpen()).toBe(false)
    expect(f.ctrl.isOpen()).toBe(false)
  })

  it('面板开着时开菜单 → 推送的面板 route 先清空（面板让位）', () => {
    const f = setup()
    f.ctrl.open('message')
    f.ctrl.openMenu()
    expect(f.pushed.at(-1)).toEqual({ panelOpen: false, routeId: null, menuOpen: true })
  })
})
