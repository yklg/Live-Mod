import { describe, expect, it, vi } from 'vitest'
import {
  getZoomStorePath,
  loadZoomFactor,
  parseZoomMemory,
  saveZoomFactor,
  serializeZoomMemory,
  ZOOM_MEMORY_VERSION,
  ZOOM_STORE_FILE,
  type ZoomStoreIo,
} from '#/services/ZoomStore'
import { ZOOM_DEFAULT } from '#/windows/pageZoom'

// 主进程无 Electron 运行时（vitest）——仅 mock getPath('userData')，与 EntryStore.test 同构。
// 本模块顶层 import { app } from 'electron'：CI 的 pnpm 默认不跑依赖构建脚本（无 electron 二进制），
// 未 mock 会在 import 阶段抛 "Electron failed to install correctly"（Unit Tests 红）。
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

// ===== 缩放记忆持久化（验证期用户反馈：按站点记住缩放） =====
// 契约：parse 对非法/版本不符/畸形值降级为空记忆；load 未记录=默认 1；save 默认值落盘时删除该 host。
function memoryIo(initial: string | null): { io: ZoomStoreIo; dump: () => string } {
  let content = initial
  const io: ZoomStoreIo = {
    path: '/tmp/zoom-test.json',
    readFile: () => content,
    writeFile: (_p, data) => {
      content = data
    },
  }
  return { io, dump: () => content ?? '' }
}

describe('ZoomStore（TC-ZS1~ZS6）', () => {
  it('TC-ZS6 记忆文件路径：userData/shell-zoom.json（mock 注入下可测）', () => {
    expect(getZoomStorePath()).toBe(`/mock/userData/${ZOOM_STORE_FILE}`)
  })

  it('TC-ZS1 parse：空/非法 JSON/版本不符 → 空记忆（不抛）', () => {
    expect(parseZoomMemory(null).byHost).toEqual({})
    expect(parseZoomMemory('not json').byHost).toEqual({})
    expect(parseZoomMemory(JSON.stringify({ version: 99, byHost: { a: 0.8 } })).byHost).toEqual({})
    expect(parseZoomMemory(JSON.stringify({ version: ZOOM_MEMORY_VERSION })).byHost).toEqual({})
  })

  it('TC-ZS2 parse：非法 factor 过滤，合法值夹取归一', () => {
    const raw = JSON.stringify({
      version: ZOOM_MEMORY_VERSION,
      byHost: { a: 0.75, b: 'x', c: 9, d: Number.NaN },
    })
    const m = parseZoomMemory(raw)
    expect(m.byHost.a).toBe(0.75)
    expect(m.byHost.b).toBeUndefined()
    expect(m.byHost.c).toBe(2)
    expect(Object.keys(m.byHost)).toEqual(expect.arrayContaining(['a']))
  })

  it('TC-ZS3 serialize→parse 往返一致', () => {
    const memory = { version: ZOOM_MEMORY_VERSION, byHost: { 'buyin.jinritemai.com': 0.8 } }
    expect(parseZoomMemory(serializeZoomMemory(memory))).toEqual(memory)
  })

  it('TC-ZS4 load：未记录 → 默认 1；读异常 → 默认 1（不阻断浏览）', () => {
    expect(loadZoomFactor('unknown.host', memoryIo(null).io)).toBe(ZOOM_DEFAULT)
    expect(
      loadZoomFactor('a.com', {
        path: '/tmp/x',
        readFile: () => {
          throw new Error('EACCES')
        },
      }),
    ).toBe(ZOOM_DEFAULT)
  })

  it('TC-ZS5 save：记录/覆盖/恢复默认时删除 host；写异常 → false 不抛', () => {
    const io = memoryIo(null)
    expect(saveZoomFactor('a.com', 0.8, io.io)).toBe(true)
    expect(loadZoomFactor('a.com', io.io)).toBe(0.8)
    expect(saveZoomFactor('b.com', 1.2, io.io)).toBe(true)
    expect(JSON.parse(io.dump()).byHost).toEqual({ 'a.com': 0.8, 'b.com': 1.2 })
    // 恢复 100% → 删除该 host（文件不膨胀）
    saveZoomFactor('a.com', 1, io.io)
    expect(JSON.parse(io.dump()).byHost).toEqual({ 'b.com': 1.2 })
    // 写失败：返回 false，不抛
    expect(
      saveZoomFactor('c.com', 0.9, {
        path: '/tmp/x',
        readFile: () => null,
        writeFile: () => {
          throw new Error('EACCES')
        },
      }),
    ).toBe(false)
  })

  it('TC-ZS7 站点默认值：未记录 → defaultFactor；与默认相同不落盘', () => {
    const io = memoryIo(null)
    // 中控台默认 80%：没有记忆时直接返回 0.8，而不是全局 1
    expect(loadZoomFactor('buyin.jinritemai.com', io.io, 0.8)).toBe(0.8)
    // 用户手动放大到 100% → 必须落盘（1 ≠ 站点默认 0.8）
    expect(saveZoomFactor('buyin.jinritemai.com', 1, io.io, 0.8)).toBe(true)
    expect(loadZoomFactor('buyin.jinritemai.com', io.io, 0.8)).toBe(1)
    // 重置回站点默认 → 删除该 host（文件不膨胀）
    saveZoomFactor('buyin.jinritemai.com', 0.8, io.io, 0.8)
    expect(JSON.parse(io.dump()).byHost).toEqual({})
  })
})
