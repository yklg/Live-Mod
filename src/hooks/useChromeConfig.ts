import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { EVENTS, eventEmitter } from '@/utils/events'
import { useAccounts } from './useAccounts'

interface ChromeConfigV1 {
  path: string
  cookies: string
}

interface ChromeConfigV2 {
  path: string
  cookies: {
    buyin: string
    douyin: string
    eos: string
  }
}

interface ChromeConfig {
  path: string
  storageState: string
  headless: boolean
  /** 壳模式（R1' attach 驱动）：旧持久化数据无此字段 = undefined = 关闭，无需迁移 */
  shellMode: boolean
  /** 强制外部浏览器逃生口（v3·仅壳 UI 形态生效）：同 shellMode 无迁移先例，undefined = false */
  forceExternal: boolean
}

interface ChromeConfigStore {
  contexts: Record<string, ChromeConfig>
  setPath: (accountId: string, path: string) => void
  setStorageState: (accountId: string, storageState: string) => void
  setHeadless: (accountId: string, headless: boolean) => void
  setShellMode: (accountId: string, shellMode: boolean) => void
  setForceExternal: (accountId: string, forceExternal: boolean) => void
}

const defaultContext = (): ChromeConfig => ({
  path: '',
  storageState: '',
  headless: false,
  shellMode: false,
  forceExternal: false,
})

export const useChromeConfigStore = create<ChromeConfigStore>()(
  persist(
    immer(set => {
      eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
        set(state => {
          delete state.contexts[accountId]
        })
      })

      const ensureContext = (state: ChromeConfigStore, accountId: string) => {
        if (!state.contexts[accountId]) {
          state.contexts[accountId] = defaultContext()
        }
        return state.contexts[accountId]
      }
      return {
        contexts: {
          default: defaultContext(),
        },
        setPath: (accountId, path) => {
          set(state => {
            const context = ensureContext(state, accountId)
            context.path = path
          })
        },
        setStorageState: (accountId, storageState) => {
          set(state => {
            const context = ensureContext(state, accountId)
            context.storageState = storageState
          })
        },
        setHeadless: (accountId, headless) => {
          set(state => {
            const context = ensureContext(state, accountId)
            context.headless = headless
          })
        },
        setShellMode: (accountId, shellMode) => {
          set(state => {
            const context = ensureContext(state, accountId)
            context.shellMode = shellMode
          })
        },
        setForceExternal: (accountId, forceExternal) => {
          set(state => {
            const context = ensureContext(state, accountId)
            context.forceExternal = forceExternal
          })
        },
      }
    }),
    {
      name: 'chrome-config',
      version: 4,
      migrate: (persistedState, version) => {
        if (version === 0) {
          const persisted = persistedState as ChromeConfigV1
          return {
            contexts: {
              default: {
                path: persisted?.path,
                storageState: '',
              },
            },
          }
        }
        if (version === 1) {
          const persisted = persistedState as {
            contexts: Record<string, ChromeConfigV1>
          }
          return {
            contexts: Object.fromEntries(
              Object.entries(persisted.contexts).map(([accountId, context]) => [
                accountId,
                {
                  ...context,
                  storageState: '',
                },
              ]),
            ),
          }
        }
        if (version === 3) {
          const persisted = persistedState as ChromeConfigV2
          return {
            contexts: {
              default: {
                path: persisted?.path,
                storageState: '',
              },
            },
          }
        }
      },
    },
  ),
)

export function useCurrentChromeConfig<T>(getters: (state: ChromeConfig) => T): T {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  return useChromeConfigStore(state => {
    const context = state.contexts[currentAccountId] ?? defaultContext()
    return getters(context)
  })
}

export function useCurrentChromeConfigActions() {
  const setPath = useChromeConfigStore(state => state.setPath)
  const setStorageState = useChromeConfigStore(state => state.setStorageState)
  const setHeadless = useChromeConfigStore(state => state.setHeadless)
  const setShellMode = useChromeConfigStore(state => state.setShellMode)
  const setForceExternal = useChromeConfigStore(state => state.setForceExternal)
  const currentAccountId = useAccounts(state => state.currentAccountId)

  return useMemo(
    () => ({
      setPath: (path: string) => setPath(currentAccountId, path),
      setStorageState: (storageState: string) => setStorageState(currentAccountId, storageState),
      setHeadless: (headless: boolean) => setHeadless(currentAccountId, headless),
      setShellMode: (shellMode: boolean) => setShellMode(currentAccountId, shellMode),
      setForceExternal: (forceExternal: boolean) =>
        setForceExternal(currentAccountId, forceExternal),
    }),
    [currentAccountId, setPath, setStorageState, setHeadless, setShellMode, setForceExternal],
  )
}
