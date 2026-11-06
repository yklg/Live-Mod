import { describe, expect, it, vi } from 'vitest'
import { foldNavigate } from '#/windows/foldNavigate'

// ===== fold 失败模式定档（seamless-fix v3 · A1-Q6，G3 覆盖）=====
// 契约：成功='fold-ok'；loadURL 抛错或超时='fold-fallback-deny'（页面停留原 URL，禁止半导航态）
describe('foldNavigate（TC-F1~F3）', () => {
  it('TC-F3 成功 → fold-ok', async () => {
    const logs: string[] = []
    const loadURL = vi.fn(async () => undefined)
    const r = await foldNavigate({
      loadURL,
      url: 'https://a.com/b',
      timeoutMs: 100,
      log: s => logs.push(s),
    })
    expect(r).toBe('fold-ok')
    expect(logs.join('')).toContain('popup-rule=fold fold-ok')
  })

  it('TC-F1 loadURL 抛错 → fallback deny + 结构化日志', async () => {
    const logs: string[] = []
    const loadURL = vi.fn(async () => {
      throw new Error('ERR_BLOCKED')
    })
    const r = await foldNavigate({
      loadURL,
      url: 'https://a.com/b',
      timeoutMs: 100,
      log: s => logs.push(s),
    })
    expect(r).toBe('fold-fallback-deny')
    expect(logs.join('')).toContain('fold-fallback-deny')
  })

  it('TC-F2 超时 → fallback deny（不悬挂）', async () => {
    vi.useFakeTimers()
    const logs: string[] = []
    const loadURL = vi.fn(() => new Promise<void>(() => {})) // 永不 resolve
    const p = foldNavigate({
      loadURL,
      url: 'https://a.com/b',
      timeoutMs: 1000,
      log: s => logs.push(s),
    })
    await vi.advanceTimersByTimeAsync(1001)
    await expect(p).resolves.toBe('fold-fallback-deny')
    vi.useRealTimers()
  })
})
