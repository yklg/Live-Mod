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
import { PANEL_MAX, PANEL_MIN } from '#/windows/shellLayout'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

const state = (over: Partial<LayoutState> = {}): LayoutState => ({
  version: LAYOUT_STORE_VERSION,
  panelWidth: 600,
  panelOpen: true,
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

describe('parseLayoutState（schema / 钳制 / 未知路由）', () => {
  it('TC-LS1 [往返] serialize → parse 恒等', () => {
    const value = state()
    expect(parseLayoutState(serializeLayoutState(value))).toEqual(value)
  })

  it('TC-LS2 [宽度钳制] 越界按 PANEL_MIN/PANEL_MAX 静态钳制', () => {
    expect(parseLayoutState(JSON.stringify(state({ panelWidth: PANEL_MIN - 1 })))?.panelWidth).toBe(
      PANEL_MIN,
    )
    expect(parseLayoutState(JSON.stringify(state({ panelWidth: PANEL_MAX + 1 })))?.panelWidth).toBe(
      PANEL_MAX,
    )
    expect(parseLayoutState(JSON.stringify(state({ panelWidth: -1 })))?.panelWidth).toBe(PANEL_MIN)
    expect(parseLayoutState(JSON.stringify(state({ panelWidth: 9999 })))?.panelWidth).toBe(
      PANEL_MAX,
    )
  })

  it('TC-LS3 [未知路由] ai / 未知 id → routeId=null，但保留宽度/开合', () => {
    for (const routeId of ['ai', 'nope', '', 'settings-legacy']) {
      const parsed = parseLayoutState(JSON.stringify(state({ routeId: routeId as never })))
      expect(parsed?.routeId).toBeNull()
      expect(parsed?.panelWidth).toBe(600)
      expect(parsed?.panelOpen).toBe(true)
    }
    expect(parseLayoutState(JSON.stringify(state({ routeId: null })))?.routeId).toBeNull()
    expect(parseLayoutState(JSON.stringify(state({ routeId: 'reply-settings' })))?.routeId).toBe(
      'reply-settings',
    )
  })

  it('TC-LS4 [损坏输入] 非法 JSON/版本/字段类型 → null', () => {
    const raws: Array<string | null> = [null, '', ' ', 'not-json', '{', '"str"', 'null', '[]', '42']
    for (const raw of raws) {
      expect(() => parseLayoutState(raw)).not.toThrow()
      expect(parseLayoutState(raw)).toBeNull()
    }
    for (const version of [0, 2, 99, '1']) {
      expect(parseLayoutState(JSON.stringify(state({ version: version as never })))).toBeNull()
    }
    for (const panelWidth of [Number.NaN, Number.POSITIVE_INFINITY, '600', null, undefined]) {
      expect(
        parseLayoutState(JSON.stringify({ ...state(), panelWidth })),
        `panelWidth=${String(panelWidth)}`,
      ).toBeNull()
    }
    for (const panelOpen of ['true', 1, null, undefined]) {
      expect(parseLayoutState(JSON.stringify({ ...state(), panelOpen }))).toBeNull()
    }
    expect(parseLayoutState(JSON.stringify({ ...state(), routeId: 42 }))).toBeNull()
  })
})

describe('loadLayoutState（默认/损坏/io 注入）', () => {
  it('TC-LS5 [缺失/损坏/读异常] → DEFAULT_LAYOUT_STATE', () => {
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
    expect(loadLayoutState({ path: '/x', readFile: () => null })).toEqual(DEFAULT_LAYOUT_STATE)
  })

  it('TC-LS6 [注入 io] readFile 收到指定 path，返回值经 parse', () => {
    const value = state({ panelWidth: 720, routeId: 'message' })
    const readFile = vi.fn(() => serializeLayoutState(value))
    expect(loadLayoutState({ path: '/x/shell-layout.json', readFile })).toEqual(value)
    expect(readFile).toHaveBeenCalledWith('/x/shell-layout.json')
  })

  it('TC-LS7 [默认 fs 集成] save → load 往返恒等', () => {
    const filePath = path.join(tmpDir, LAYOUT_STORE_FILE)
    const value = state({ panelWidth: 880, panelOpen: false, routeId: 'interaction' })
    expect(saveLayoutState(value, { path: filePath })).toBe(true)
    expect(loadLayoutState({ path: filePath })).toEqual(value)
  })
})

describe('saveLayoutState / path', () => {
  it('TC-LS8 [路径] = userData/shell-layout.json', () => {
    expect(LAYOUT_STORE_FILE).toBe('shell-layout.json')
    expect(getLayoutStorePath()).toBe(path.join('/mock/userData', LAYOUT_STORE_FILE))
  })

  it('TC-LS9 [注入 io] writeFile 收到 path 与规范化文本，返回 true', () => {
    const writeFile = vi.fn<(p: string, data: string) => void>()
    const value = state({ panelWidth: 9999, routeId: 'ai' as never })
    expect(saveLayoutState(value, { path: '/x/a.json', writeFile })).toBe(true)
    expect(writeFile).toHaveBeenCalledTimes(1)
    const [calledPath, data] = writeFile.mock.calls[0]
    expect(calledPath).toBe('/x/a.json')
    const parsed = parseLayoutState(data)
    expect(parsed?.panelWidth).toBe(PANEL_MAX)
    expect(parsed?.routeId).toBeNull()
    expect(parsed?.version).toBe(LAYOUT_STORE_VERSION)
  })

  it('TC-LS10 [写异常] → false 且不抛', () => {
    const writeFile = () => {
      throw new Error('EROFS')
    }
    expect(() => saveLayoutState(state(), { path: '/x/a.json', writeFile })).not.toThrow()
    expect(saveLayoutState(state(), { path: '/x/a.json', writeFile })).toBe(false)
    expect(saveLayoutState(state(), { path: tmpDir })).toBe(false)
    expect(saveLayoutState(state(), { path: path.join(tmpDir, 'missing/a.json') })).toBe(false)
  })
})
