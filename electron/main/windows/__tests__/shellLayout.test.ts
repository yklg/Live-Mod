import { describe, expect, it } from 'vitest'
import {
  BROWSER_BAR_H,
  chromeHeight,
  clampDockWidth,
  computeEntryBounds,
  computeShellBounds,
  DOCK_MAX,
  DOCK_MIN,
  DOCK_W,
  dockFits,
  draggedPanelWidth,
  MENU_H,
  MENU_W,
  PAGE_MIN,
  TABSTRIP_H,
  TOPBAR_H,
} from '#/windows/shellLayout'

// 壳 v3 · Wave 2：图标条删除后 rail 视图只承载面板；overlay 模式下 page 永远满宽。
// 守护不变量：
//   I1 收起态：rail 宽度 = 0（视图保留不销毁），page 满宽
//   I2 overlay（默认）：打开态 rail = dock 宽，page **不变**（满宽）
//   I3 dock（保留，不启用）：打开态 page 让出 dock 宽度，受 PAGE_MIN 门禁
//   I4 entry：page=null，entry 满宽，rail 宽度 0
//   I5 dockFits 只在 dock 分支被调用（overlay 不挤占 page，不需要门禁）

describe('chromeHeight / dock 常量', () => {
  it('三模式高度：entry 52 / live 124 / browse 124（标签行常显，中控台也在标签轴上）', () => {
    expect(chromeHeight('entry')).toBe(TOPBAR_H)
    expect(chromeHeight('live')).toBe(TOPBAR_H + BROWSER_BAR_H + TABSTRIP_H)
    expect(chromeHeight('browse')).toBe(TOPBAR_H + BROWSER_BAR_H + TABSTRIP_H)
  })

  it('dock 宽度静态钳制 320–420；非数回默认', () => {
    expect(DOCK_MIN).toBe(320)
    expect(DOCK_W).toBe(360)
    expect(DOCK_MAX).toBe(420)
    expect(clampDockWidth(200)).toBe(320)
    expect(clampDockWidth(999)).toBe(420)
    expect(clampDockWidth(Number.NaN)).toBe(360)
    expect(clampDockWidth(375.6)).toBe(376)
  })

  it('dockFits 用 PAGE_MIN=640：1000/1060 是 360/420 的边界（图标条已删，不再扣 56）', () => {
    expect(dockFits(999, 360)).toBe(false)
    expect(dockFits(1000, 360)).toBe(true)
    expect(dockFits(1059, 420)).toBe(false)
    expect(dockFits(1060, 420)).toBe(true)
    // 1024 现在**放得下** dock（1024-360=664 ≥ 640）——旧公式要再扣 56 才是 false
    expect(dockFits(1024, 360)).toBe(true)
  })
})

describe('computeShellBounds 三模式表（壳 v3 · Wave 2）', () => {
  it('entry 1280：52 顶栏、entry 满宽 1280、page=null、rail 宽度 0', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'entry',
      dockOpen: true,
      dockWidth: 420,
      activeTabPresent: true,
    })
    expect(r.chrome).toEqual({ x: 0, y: 0, width: 1280, height: 52 })
    expect(r.entry).toEqual({ x: 0, y: 52, width: 1280, height: 748 })
    // 收起态：rail 宽度归零（视图保留不销毁）
    expect(r.rail).toEqual({ x: 1280, y: 52, width: 0, height: 748 })
    expect(r.page).toBeNull()
  })

  it('live 1280 + dock 360（overlay 默认）：page 满宽 1280，rail 360 浮在右侧', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(r.chrome.height).toBe(124)
    expect(r.entry).toBeNull()
    expect(r.page).toEqual({ x: 0, y: 124, width: 1280, height: 676 })
    expect(r.rail).toEqual({ x: 1280 - 360, y: 124, width: 360, height: 676 })
  })

  it('I1 收起态：rail 宽度 0，page 满宽', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      dockOpen: false,
      activeTabPresent: true,
    })
    expect(r.rail).toEqual({ x: 1280, y: 124, width: 0, height: 676 })
    expect(r.page).toEqual({ x: 0, y: 124, width: 1280, height: 676 })
  })

  it('I2 overlay：打开与收起的 page 完全一致（面板浮在右侧不挤占官方页）', () => {
    const closed = computeShellBounds({
      winW: 1024,
      winH: 720,
      mode: 'live',
      dockOpen: false,
      activeTabPresent: true,
    })
    const overlay = computeShellBounds({
      winW: 1024,
      winH: 720,
      mode: 'live',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(overlay.page).toEqual(closed.page)
    expect(overlay.page?.width).toBe(1024)
    expect(overlay.rail).toEqual({ x: 1024 - 360, y: 124, width: 360, height: 596 })
  })

  it('I3 dock 分支（保留，不启用）：page 让出 dock 宽度，且受 PAGE_MIN 门禁', () => {
    const a = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      layoutMode: 'dock',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(a.page?.width).toBe(1280 - 360)
    expect(a.rail).toEqual({ x: 1280 - 360, y: 124, width: 360, height: 676 })

    // 1000 + 360：恰好 dock，page = PAGE_MIN
    const b = computeShellBounds({
      winW: 1000,
      winH: 800,
      mode: 'live',
      layoutMode: 'dock',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(b.page?.width).toBe(PAGE_MIN)

    // 999 + 360：放不下 → 退回 overlay，page 保持满宽
    const c = computeShellBounds({
      winW: 999,
      winH: 800,
      mode: 'live',
      layoutMode: 'dock',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(c.page?.width).toBe(999)
  })

  it('browse 1280：124 顶栏、page 满宽 1280、rail 宽度 0', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'browse',
      dockOpen: false,
      activeTabPresent: true,
    })
    expect(r.chrome.height).toBe(124)
    expect(r.entry).toBeNull()
    expect(r.page).toEqual({ x: 0, y: 124, width: 1280, height: 676 })
    expect(r.rail.width).toBe(0)
  })

  it('无 active Tab：page=null，rail 照常', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      activeTabPresent: false,
    })
    expect(r.page).toBeNull()
    expect(r.rail.width).toBe(0)
  })

  it('纯性：同输入 deep-equal', () => {
    const input = {
      winW: 1280,
      winH: 800,
      mode: 'live' as const,
      dockOpen: true,
      dockWidth: 420,
      activeTabPresent: true,
    }
    expect(computeShellBounds(input)).toEqual(computeShellBounds(input))
  })
})

describe('顶栏悬浮菜单几何（壳 v3 · Wave 3）', () => {
  it('菜单开：rail 232×296 浮在右上，page 不变', () => {
    const closed = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      dockOpen: false,
      activeTabPresent: true,
    })
    const menu = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      dockOpen: false,
      menuOpen: true,
      activeTabPresent: true,
    })
    expect(menu.rail).toEqual({ x: 1280 - MENU_W, y: 124, width: MENU_W, height: MENU_H })
    // 菜单不挤占官方页：page 与收起态完全一致
    expect(menu.page).toEqual(closed.page)
    expect(menu.page?.width).toBe(1280)
  })

  it('菜单优先级高于面板：两者同开时按菜单几何走', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      dockOpen: true,
      dockWidth: 360,
      menuOpen: true,
      activeTabPresent: true,
    })
    expect(r.rail.width).toBe(MENU_W)
    expect(r.rail.height).toBe(MENU_H)
  })

  it('entry 模式下菜单不生效（入口=平台选择器，菜单/面板都不该出现）', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'entry',
      menuOpen: true,
      activeTabPresent: true,
    })
    expect(r.rail.width).toBe(0)
    expect(r.page).toBeNull()
  })
})

describe('入口几何', () => {
  it('entry 1280：52 顶栏、满宽 1280；live 124', () => {
    expect(computeEntryBounds({ winW: 1280, winH: 800, mode: 'entry' })).toEqual({
      x: 0,
      y: 52,
      width: 1280,
      height: 748,
    })
    expect(computeEntryBounds({ winW: 1280, winH: 800, mode: 'live' })).toEqual({
      x: 0,
      y: 124,
      width: 1280,
      height: 676,
    })
  })

  it('拖拽算术沿用：向左变宽、向右变窄', () => {
    expect(draggedPanelWidth(360, 1000, 900)).toBe(460)
    expect(draggedPanelWidth(360, 1000, 1100)).toBe(260)
  })
})
