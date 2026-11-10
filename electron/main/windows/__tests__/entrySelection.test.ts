import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ready: vi.fn(() => true),
  load: vi.fn(),
  save: vi.fn(() => true),
  sendTo: vi.fn(),
}))

vi.mock('#/windows/entryStartup', () => ({ isEntryRailReady: h.ready }))
vi.mock('#/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  }),
}))
vi.mock('#/services/EntryStore', () => ({
  loadEntryMemory: h.load,
  saveEntryMemory: h.save,
}))
vi.mock('#/windowManager', () => ({ default: { sendTo: h.sendTo } }))

import { ENTRY_MEMORY_VERSION } from '#/windows/entryIntent'
import { selectEntry, setEntryRemember } from '#/windows/entrySelection'

const memory = {
  version: ENTRY_MEMORY_VERSION,
  lastPlatform: 'douyin',
  autoRestore: true,
  updatedAt: '2026-11-10T00:00:00.000Z',
}

describe('entrySelection 写路径', () => {
  beforeEach(() => {
    h.ready.mockReset().mockReturnValue(true)
    h.load.mockReset()
    h.save.mockReset().mockReturnValue(true)
    h.sendTo.mockReset()
  })

  it('合法平台 + rail ready → 落记忆 + 派发 manual intent', () => {
    const result = selectEntry('douyin', true, true)
    expect(result.ok).toBe(true)
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastPlatform: 'douyin', autoRestore: true }),
    )
    expect(h.sendTo).toHaveBeenCalledWith(
      'ui',
      expect.anything(),
      expect.objectContaining({ platform: 'douyin', source: 'manual' }),
    )
  })

  it('shell 关闭 / 未知平台 → 不写不派发', () => {
    expect(selectEntry('douyin', true, false)).toEqual({ ok: false, reason: 'shell-disabled' })
    expect(selectEntry('kuaishou', true, true)).toEqual({ ok: false, reason: 'unknown' })
    expect(h.save).not.toHaveBeenCalled()
    expect(h.sendTo).not.toHaveBeenCalled()
  })

  it('rail 未就绪 → shell-not-ready，先不写不派发（防选择器消失但没连接）', () => {
    h.ready.mockReturnValue(false)
    expect(selectEntry('douyin', true, true)).toEqual({ ok: false, reason: 'shell-not-ready' })
    expect(h.save).not.toHaveBeenCalled()
    expect(h.sendTo).not.toHaveBeenCalled()
  })

  it('entryRememberSet：非 boolean 拒绝；无记忆 no-op；有记忆更新 autoRestore', () => {
    expect(setEntryRemember('true' as never)).toBe(false)
    expect(h.save).not.toHaveBeenCalled()

    h.load.mockReturnValue(null)
    expect(setEntryRemember(false)).toBe(true)
    expect(h.save).not.toHaveBeenCalled()

    h.load.mockReturnValue(memory)
    expect(setEntryRemember(false)).toBe(true)
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastPlatform: 'douyin', autoRestore: false }),
    )
  })
})
