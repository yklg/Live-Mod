import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LAYOUT_STATE,
  getLayoutStorePath,
  LAYOUT_STORE_FILE,
  LAYOUT_STORE_VERSION,
  type LayoutState,
  loadLayoutState,
  parseLayoutState,
  saveLayoutState,
  serializeLayoutState,
} from '#/services/LayoutStore'
import { DOCK_MAX, DOCK_MIN, DOCK_W } from '#/windows/shellLayout'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

const state = (over: Partial<LayoutState> = {}): LayoutState => ({
  version: LAYOUT_STORE_VERSION,
  dockWidth: DOCK_W,
  dockOpen: true,
  routeId: 'settings',
  ...over,
})

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-mod-layout-store-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('parseLayoutState v2（schema / 钳制 / 未知路由）', () => {
  it('往返恒等', () => {
    const value = state()
    expect(parseLayoutState(serializeLayoutState(value))).toEqual(value)
  })

  it('dockWidth 静态钳制 320–420', () => {
    expect(parseLayoutState(JSON.stringify(state({ dockWidth: DOCK_MIN - 1 })))?.dockWidth).toBe(
      DOCK_MIN,
    )
    expect(parseLayoutState(JSON.stringify(state({ dockWidth: DOCK_MAX + 1 })))?.dockWidth).toBe(
      DOCK_MAX,
    )
    expect(parseLayoutState(JSON.stringify(state({ dockWidth: -1 })))?.dockWidth).toBe(DOCK_MIN)
    expect(parseLayoutState(JSON.stringify(state({ dockWidth: 9999 })))?.dockWidth).toBe(DOCK_MAX)
  })

  it('未知路由 / ai 退场 → null，但保留 dock', () => {
    for (const routeId of ['ai', 'nope', '', 'settings-legacy']) {
      const parsed = parseLayoutState(JSON.stringify(state({ routeId: routeId as never })))
      expect(parsed?.routeId).toBeNull()
      expect(parsed?.dockWidth).toBe(DOCK_W)
      expect(parsed?.dockOpen).toBe(true)
    }
    expect(parseLayoutState(JSON.stringify(state({ routeId: 'reply-settings' })))?.routeId).toBe(
      'reply-settings',
    )
  })

  it('损坏输入 → null', () => {
    for (const raw of [null, '', ' ', 'not-json', '{', '"str"', 'null', '[]', '42']) {
      expect(parseLayoutState(raw)).toBeNull()
    }
    for (const version of [0, 3, 99, '2']) {
      expect(parseLayoutState(JSON.stringify(state({ version: version as never })))).toBeNull()
    }
    for (const dockWidth of [Number.NaN, Number.POSITIVE_INFINITY, '360', null, undefined]) {
      expect(parseLayoutState(JSON.stringify({ ...state(), dockWidth }))).toBeNull()
    }
    for (const dockOpen of ['true', 1, null, undefined]) {
      expect(parseLayoutState(JSON.stringify({ ...state(), dockOpen }))).toBeNull()
    }
  })
})

describe('v1 → v2 迁移', () => {
  it('panelWidth/panelOpen 映射为 dockWidth/dockOpen 并钳制', () => {
    const v1 = JSON.stringify({
      version: 1,
      panelWidth: 600,
      panelOpen: true,
      routeId: 'settings',
    })
    expect(parseLayoutState(v1)).toEqual({
      version: 2,
      dockWidth: 420,
      dockOpen: true,
      routeId: 'settings',
    })
    const small = JSON.stringify({ version: 1, panelWidth: 100, panelOpen: false, routeId: null })
    expect(parseLayoutState(small)).toEqual({
      version: 2,
      dockWidth: 320,
      dockOpen: false,
      routeId: null,
    })
  })

  it('v1 非法字段仍拒绝', () => {
    expect(
      parseLayoutState(JSON.stringify({ version: 1, panelWidth: '600', panelOpen: true })),
    ).toBeNull()
    expect(
      parseLayoutState(JSON.stringify({ version: 1, panelWidth: 600, panelOpen: 1 })),
    ).toBeNull()
  })
})

describe('load/save', () => {
  it('缺失/损坏/读异常 → DEFAULT', () => {
    expect(loadLayoutState({ path: path.join(tmpDir, 'nope.json') })).toEqual(DEFAULT_LAYOUT_STATE)
    expect(loadLayoutState({ path: '/x', readFile: () => 'broken' })).toEqual(DEFAULT_LAYOUT_STATE)
    expect(
      loadLayoutState({
        path: '/x',
        readFile: () => {
          throw new Error('EACCES')
        },
      }),
    ).toEqual(DEFAULT_LAYOUT_STATE)
  })

  it('默认 fs 往返；路径 = userData/shell-layout.json', () => {
    const filePath = path.join(tmpDir, LAYOUT_STORE_FILE)
    const value = state({ dockWidth: 420, dockOpen: false, routeId: 'interaction' })
    expect(saveLayoutState(value, { path: filePath })).toBe(true)
    expect(loadLayoutState({ path: filePath })).toEqual(value)
    expect(getLayoutStorePath()).toBe(path.join('/mock/userData', LAYOUT_STORE_FILE))
  })

  it('写异常返回 false；写前规范化', () => {
    const writeFile = vi.fn<(p: string, data: string) => void>()
    expect(saveLayoutState(state({ dockWidth: 9999 }), { path: '/x', writeFile })).toBe(true)
    expect(parseLayoutState(writeFile.mock.calls[0][1])?.dockWidth).toBe(DOCK_MAX)
    const boom = () => {
      throw new Error('EROFS')
    }
    expect(saveLayoutState(state(), { path: '/x', writeFile: boom })).toBe(false)
  })
})
