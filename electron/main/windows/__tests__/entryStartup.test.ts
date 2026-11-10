import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadEntryMemory: vi.fn(),
  sendTo: vi.fn(),
  apply: vi.fn(),
}))

vi.mock('#/services/EntryStore', () => ({
  loadEntryMemory: h.loadEntryMemory,
  saveEntryMemory: vi.fn(() => true),
}))
vi.mock('#/windowManager', () => ({
  default: { sendTo: h.sendTo },
}))
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

import { ENTRY_MEMORY_VERSION } from '#/windows/entryIntent'
import {
  configureEntryStartup,
  handleEntryReady,
  isEntryRailReady,
  resetEntryStartupForTest,
  startEntryFallback,
} from '#/windows/entryStartup'

const memory = (over: Record<string, unknown> = {}) => ({
  version: ENTRY_MEMORY_VERSION,
  lastPlatform: 'douyin',
  autoRestore: true,
  updatedAt: '2026-11-10T00:00:00.000Z',
  ...over,
})

describe('entryStartup 启动裁决', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.loadEntryMemory.mockReset()
    h.sendTo.mockReset()
    h.apply.mockReset()
    configureEntryStartup({ applySurface: h.apply })
    resetEntryStartupForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('无记忆 → entry；railReady 记录为 true', () => {
    h.loadEntryMemory.mockReturnValue(null)
    handleEntryReady()
    expect(h.apply).toHaveBeenCalledWith('entry')
    expect(h.sendTo).not.toHaveBeenCalled()
    expect(isEntryRailReady()).toBe(true)
  })

  it('autoRestore 命中 → live + restoreDock + restore intent', () => {
    h.loadEntryMemory.mockReturnValue(memory())
    handleEntryReady()
    expect(h.apply).toHaveBeenCalledWith('live', { restoreDock: true })
    expect(h.sendTo).toHaveBeenCalledWith(
      'ui',
      expect.anything(),
      expect.objectContaining({ platform: 'douyin', source: 'restore' }),
    )
  })

  it('autoRestore=false / 版本不符 → entry', () => {
    h.loadEntryMemory.mockReturnValue(memory({ autoRestore: false }))
    handleEntryReady()
    expect(h.apply).toHaveBeenCalledWith('entry')
    expect(h.sendTo).not.toHaveBeenCalled()
  })

  it('5s 未握手 → fallbackEntry 终态；迟到 railReady 不覆盖', () => {
    h.loadEntryMemory.mockReturnValue(memory())
    startEntryFallback()
    vi.advanceTimersByTime(5000)
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.apply).toHaveBeenCalledWith('entry')
    handleEntryReady()
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.sendTo).not.toHaveBeenCalled()
    expect(isEntryRailReady()).toBe(true)
  })

  it('railReady 前已切 live → 不回到 entry（预启动动作优先）', () => {
    configureEntryStartup({ applySurface: h.apply, getMode: () => 'live' })
    h.loadEntryMemory.mockReturnValue(null)
    handleEntryReady()
    expect(h.apply).not.toHaveBeenCalled()
    expect(isEntryRailReady()).toBe(true)
  })

  it('railReady 先到 → 清除 fallback timer，不再二次 apply', () => {
    h.loadEntryMemory.mockReturnValue(null)
    startEntryFallback()
    handleEntryReady()
    expect(h.apply).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(h.apply).toHaveBeenCalledTimes(1)
  })
})
