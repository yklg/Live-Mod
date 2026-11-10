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
  PAGE_MIN,
  RAIL_W,
  TABSTRIP_H,
  TOPBAR_H,
} from '#/windows/shellLayout'

describe('chromeHeight / dock 常量', () => {
  it('三模式高度：entry 52 / live 88 / browse 124', () => {
    expect(chromeHeight('entry')).toBe(TOPBAR_H)
    expect(chromeHeight('live')).toBe(TOPBAR_H + BROWSER_BAR_H)
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

  it('dockFits 无左栏：1056/1116 是 360/420 的边界', () => {
    expect(dockFits(1055, 360)).toBe(false)
    expect(dockFits(1056, 360)).toBe(true)
    expect(dockFits(1115, 420)).toBe(false)
    expect(dockFits(1116, 420)).toBe(true)
    expect(dockFits(1024, 360)).toBe(false)
  })
})

describe('computeShellBounds 三模式表', () => {
  it('entry 1280：52 顶栏、entry 1224、page=null、dock 强制收起', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'entry',
      dockOpen: true,
      dockWidth: 420,
      activeTabPresent: true,
    })
    expect(r.chrome).toEqual({ x: 0, y: 0, width: 1280, height: 52 })
    expect(r.entry).toEqual({ x: 0, y: 52, width: 1280 - RAIL_W, height: 748 })
    expect(r.rail).toEqual({ x: 1280 - RAIL_W, y: 52, width: RAIL_W, height: 748 })
    expect(r.page).toBeNull()
  })

  it('live 1280 + dock 360：page x=0 让出 360，rail 416', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(r.chrome.height).toBe(88)
    expect(r.entry).toBeNull()
    expect(r.page).toEqual({ x: 0, y: 88, width: 1280 - 360 - 56, height: 712 })
    expect(r.rail).toEqual({ x: 1280 - 360 - 56, y: 88, width: 360 + 56, height: 712 })
  })

  it('1024 + dock 360：低于 PAGE_MIN，回退 overlay，page 不变', () => {
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
    expect(overlay.page?.width).toBe(1024 - 56)
    expect(overlay.rail).toEqual({ x: 1024 - 360 - 56, y: 88, width: 416, height: 632 })
  })

  it('1056 + 360 / 1116 + 420：恰好 dock，page=PAGE_MIN', () => {
    const a = computeShellBounds({
      winW: 1056,
      winH: 800,
      mode: 'live',
      dockOpen: true,
      dockWidth: 360,
      activeTabPresent: true,
    })
    expect(a.page?.width).toBe(PAGE_MIN)
    const b = computeShellBounds({
      winW: 1116,
      winH: 800,
      mode: 'live',
      dockOpen: true,
      dockWidth: 420,
      activeTabPresent: true,
    })
    expect(b.page?.width).toBe(PAGE_MIN)
  })

  it('browse 1280：124 顶栏、标签行有位置、page 1224', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'browse',
      dockOpen: false,
      activeTabPresent: true,
    })
    expect(r.chrome.height).toBe(124)
    expect(r.entry).toBeNull()
    expect(r.page).toEqual({ x: 0, y: 124, width: 1280 - 56, height: 676 })
    expect(r.rail.width).toBe(RAIL_W)
  })

  it('无 active Tab：page=null，rail 照常', () => {
    const r = computeShellBounds({
      winW: 1280,
      winH: 800,
      mode: 'live',
      activeTabPresent: false,
    })
    expect(r.page).toBeNull()
    expect(r.rail.width).toBe(RAIL_W)
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

describe('入口几何', () => {
  it('entry 1280：52 顶栏、1224 宽；live 88', () => {
    expect(computeEntryBounds({ winW: 1280, winH: 800, mode: 'entry' })).toEqual({
      x: 0,
      y: 52,
      width: 1280 - RAIL_W,
      height: 748,
    })
    expect(computeEntryBounds({ winW: 1280, winH: 800, mode: 'live' })).toEqual({
      x: 0,
      y: 88,
      width: 1280 - RAIL_W,
      height: 712,
    })
  })

  it('拖拽算术沿用：向左变宽、向右变窄', () => {
    expect(draggedPanelWidth(360, 1000, 900)).toBe(460)
    expect(draggedPanelWidth(360, 1000, 1100)).toBe(260)
  })
})
