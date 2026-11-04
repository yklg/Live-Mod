import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'

// ⚠️ 与 index.html 的内联预置脚本共享 'appearance-storage' 的存储格式
// （{state:{mode},version:1}）。修改此处持久化结构时必须同步修改 index.html 的解析逻辑。
interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

const systemDarkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return systemDarkQuery().matches ? 'dark' : 'light'
}

/** 按 mode 解析并把 .dark 类应用到 <html>（幂等，可重复调用） */
export function applyTheme(mode: ThemeMode) {
  const resolved = resolveMode(mode)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    set => ({
      mode: 'system',
      setMode: mode => {
        set({ mode })
        applyTheme(mode)
      },
    }),
    {
      name: 'appearance-storage',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

export function useTheme() {
  const mode = useThemeStore(s => s.mode)
  const setMode = useThemeStore(s => s.setMode)
  return { mode, setMode, resolved: resolveMode(mode) }
}

/**
 * 渲染前调用：按持久化的 mode 应用主题类，并监听系统外观变化（仅 system 模式响应）。
 * index.html 的内联脚本已提前预置过 .dark 类，此处保证 store 与 DOM 一致。
 */
export function initTheme() {
  applyTheme(useThemeStore.getState().mode)
  systemDarkQuery().addEventListener('change', () => {
    if (useThemeStore.getState().mode === 'system') {
      applyTheme('system')
    }
  })
}
