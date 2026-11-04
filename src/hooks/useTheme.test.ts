import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// node 测试环境：以内存桩替代 document/window/localStorage。
// 每个用例重新加载被测模块，保证 persist 水合与监听器从干净状态开始。

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

function createEnv(options: { systemDark?: boolean; prefill?: Record<string, string> } = {}) {
  const classState: Record<string, boolean> = {}
  const classList = {
    toggle: (name: string, force?: boolean) => {
      classState[name] = force ?? !classState[name]
    },
    contains: (name: string) => !!classState[name],
  }
  const listeners = new Set<() => void>()
  // 可变的系统外观状态：模拟 MediaQueryList.matches 随系统变化
  const system = { dark: options.systemDark ?? false }
  const matchMedia = vi.fn(() => ({
    get matches() {
      return system.dark
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }))
  const storage = createMemoryStorage()
  for (const [key, value] of Object.entries(options.prefill ?? {})) {
    storage.setItem(key, value)
  }

  vi.stubGlobal('document', { documentElement: { classList } })
  vi.stubGlobal('window', { matchMedia })
  vi.stubGlobal('localStorage', storage)

  return { classState, listeners, matchMedia, storage, system }
}

async function loadThemeModule() {
  vi.resetModules()
  return import('./useTheme')
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTheme 主题状态机（TC-06 ~ TC-09）', () => {
  it('TC-06 [ST-01] light/dark/system 三档状态迁移正确切换 .dark 类', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadThemeModule()

    useThemeStore.getState().setMode('dark')
    expect(env.classState.dark).toBe(true)

    useThemeStore.getState().setMode('light')
    expect(env.classState.dark).toBe(false)

    useThemeStore.getState().setMode('system')
    expect(env.classState.dark).toBe(true) // systemDark=true

    useThemeStore.getState().setMode('light')
    expect(env.classState.dark).toBe(false)
  })

  it('TC-07 [ST-01] system 模式响应系统外观变化，显式模式不响应', async () => {
    const env = createEnv({ systemDark: false })
    const { useThemeStore, initTheme } = await loadThemeModule()

    useThemeStore.getState().setMode('system')
    initTheme()
    expect(env.listeners.size).toBe(1)

    // 系统切换为深色
    env.system.dark = true
    for (const cb of env.listeners) cb()
    expect(env.classState.dark).toBe(true)

    // 显式浅色后系统变化不再影响
    useThemeStore.getState().setMode('light')
    expect(env.classState.dark).toBe(false)
    for (const cb of env.listeners) cb()
    expect(env.classState.dark).toBe(false)
  })

  it('TC-08 [CFG-01] appearance-storage 缺失时默认 system 且不抛错', async () => {
    const env = createEnv()
    const { useThemeStore, initTheme } = await loadThemeModule()

    expect(() => initTheme()).not.toThrow()
    expect(useThemeStore.getState().mode).toBe('system')
    expect(env.classState.dark).toBe(false) // systemDark 默认 false
  })

  it('TC-08b [CFG-01] 持久化的 mode 在重新加载后恢复', async () => {
    createEnv({
      prefill: { 'appearance-storage': JSON.stringify({ state: { mode: 'dark' }, version: 1 }) },
    })
    const { useThemeStore, applyTheme, initTheme } = await loadThemeModule()

    expect(useThemeStore.getState().mode).toBe('dark')
    applyTheme(useThemeStore.getState().mode)
    initTheme()
    // classList 由本用例独立 env 持有，这里只验证 store 恢复
    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('TC-09 [INV-02] applyTheme 重复调用幂等', async () => {
    const env = createEnv({ systemDark: true })
    const { applyTheme } = await loadThemeModule()

    applyTheme('dark')
    applyTheme('dark')
    applyTheme('dark')
    expect(env.classState.dark).toBe(true)

    applyTheme('light')
    applyTheme('light')
    expect(env.classState.dark).toBe(false)
  })
})
