import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// index.tsx 顶层创建 zustand persist store（createJSONStorage(() => localStorage)），
// 且依赖链含 useIpc 的 window.ipcRenderer —— node 测试环境下全部打桩。
// 注意：打桩必须先于动态 import（store 创建时即读取 localStorage）。

function createMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => void map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size
    },
  }
}

const memoryStorage = createMemoryStorage()
vi.stubGlobal('window', {
  ipcRenderer: { on: vi.fn(() => vi.fn()), invoke: vi.fn(), send: vi.fn() },
})
vi.stubGlobal('localStorage', memoryStorage)

beforeEach(() => {
  memoryStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { formatRemaining } = await import('./index')

describe('formatRemaining 倒计时格式化（TC-12）', () => {
  it('TC-12.1 [IN-02] 0 秒返回空串', () => {
    expect(formatRemaining(0)).toBe('')
  })

  it('TC-12.2 [IN-02] 负数返回空串', () => {
    expect(formatRemaining(-5)).toBe('')
  })

  it('TC-12.3 [IN-02] 59 秒只显示秒', () => {
    expect(formatRemaining(59)).toBe('59秒')
  })

  it('TC-12.4 [IN-02] 60 秒进位到分（秒段无条件追加，特征化既有实现）', () => {
    expect(formatRemaining(60)).toBe('1分0秒')
  })

  it('TC-12.5 [IN-02] 61 秒 = 1分1秒', () => {
    expect(formatRemaining(61)).toBe('1分1秒')
  })

  it('TC-12.6 [IN-02] 3599 秒 = 59分59秒（进位上边界）', () => {
    expect(formatRemaining(3599)).toBe('59分59秒')
  })

  it('TC-12.7 [IN-02] 3600 秒进位到时（秒段无条件追加，特征化既有实现）', () => {
    expect(formatRemaining(3600)).toBe('1时0秒')
  })

  it('TC-12.8 [IN-02] 3661 秒 = 1时1分1秒', () => {
    expect(formatRemaining(3661)).toBe('1时1分1秒')
  })

  it('TC-12.9 [IN-02] 7322 秒 = 2时2分2秒', () => {
    expect(formatRemaining(7322)).toBe('2时2分2秒')
  })
})
