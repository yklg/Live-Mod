import {
  type AIConfig,
  type AIConfigType,
  type AIProvider,
  type AIProviderSetPayload,
  type AIProviderState,
  applyProviderConfigPatch,
  createDefaultAIProviderState,
  type ProviderConfig,
} from 'shared/aiProvider'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// 与 STORAGE_KEYS.AI_CHAT 同值；仅迁移读取，不写。
const AI_CHAT_LEGACY_STORAGE = 'ai-chat-storage'

export type { AIConfig, AIConfigType, AIProvider, AIProviderState, ProviderConfig }

// 渲染层只做 IPC 缓存：主进程 AIProviderStore 是唯一持久化/合并真源。
// 旧 localStorage('ai-chat-storage') 只在首次 hydration 时一次性迁移，之后不再写。
interface AIProviderStore extends AIProviderState {
  hydrated: boolean
  setCustomBaseURL: (type: AIConfigType, url: string) => void
  setConfig: (type: AIConfigType, config: Partial<ProviderConfig>) => void
  setApiKey: (type: AIConfigType, provider: AIProvider, key: string) => void
  applyState: (state: AIProviderState) => void
  setHydrated: (value: boolean) => void
}

const bridge = () =>
  typeof window !== 'undefined'
    ? (window as unknown as { ipcRenderer?: { invoke: (c: string, ...a: unknown[]) => unknown } })
        .ipcRenderer
    : undefined

function sendSet(payload: AIProviderSetPayload) {
  void bridge()?.invoke(IPC_CHANNELS.aiProvider.set, payload)
}

export const useAIProviderStore = create<AIProviderStore>()(
  immer(set => ({
    ...createDefaultAIProviderState(),
    hydrated: false,
    setCustomBaseURL: (type, url) => {
      set(state => {
        state[type].customBaseURL = url
      })
      sendSet({ type, patch: { customBaseURL: url } })
    },
    setConfig: (type, config) => {
      set(state => {
        state[type].config = applyProviderConfigPatch(state[type].config, config)
      })
      sendSet({ type, patch: { config } })
    },
    setApiKey: (type, provider, key) => {
      set(state => {
        state[type].apiKeys[provider] = key
      })
      sendSet({ type, patch: { apiKey: { provider, key } } })
    },
    applyState: state => {
      set(draft => {
        draft.chat = state.chat
        draft.autoReply = state.autoReply
        draft.hydrated = true
      })
    },
    setHydrated: value => {
      set(state => {
        state.hydrated = value
      })
    },
  })),
)

function readLegacyState(): unknown {
  try {
    const raw = window.localStorage.getItem(AI_CHAT_LEGACY_STORAGE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: unknown }
    return parsed?.state ?? null
  } catch {
    return null
  }
}

let hydrationStarted = false

/** 首次 hydration：主进程 get → 旧键一次性 migrate → 订阅主进程 state 推送。 */
export async function hydrateAIProviderStore() {
  if (hydrationStarted) return
  hydrationStarted = true
  const ipc = bridge() as
    | {
        invoke: (c: string, ...a: unknown[]) => Promise<unknown>
        on?: (c: string, cb: (payload: AIProviderState) => void) => () => void
      }
    | undefined
  if (!ipc?.invoke) {
    useAIProviderStore.getState().setHydrated(true)
    return
  }
  ipc.on?.(IPC_CHANNELS.aiProvider.state, state => {
    useAIProviderStore.getState().applyState(state)
  })
  try {
    const result = (await ipc.invoke(IPC_CHANNELS.aiProvider.get)) as {
      state: AIProviderState
      migrated: boolean
    }
    let state = result?.state
    // 迁移只由 rail 执行：assistant 可能先启动，若它先用空旧键标记 migrated，
    // rail 里的真实旧配置就永远丢失。assistant 先吃默认值，等 rail 迁移后的广播。
    const viewName = (window as unknown as { __lmView?: { name?: string } }).__lmView?.name
    if (!result?.migrated && viewName !== 'assistant') {
      state = (await ipc.invoke(
        IPC_CHANNELS.aiProvider.migrate,
        readLegacyState(),
      )) as AIProviderState
    }
    if (state) useAIProviderStore.getState().applyState(state)
    else useAIProviderStore.getState().setHydrated(true)
  } catch {
    useAIProviderStore.getState().setHydrated(true)
  }
}

if (typeof window !== 'undefined') void hydrateAIProviderStore()

export function useAIProvider(type: AIConfigType) {
  const store = useAIProviderStore()
  const props = store[type]
  const actions = {
    setConfig: (config: Partial<ProviderConfig>) => store.setConfig(type, config),
    setApiKey: (provider: AIProvider, key: string) => store.setApiKey(type, provider, key),
    setCustomBaseURL: (url: string) => store.setCustomBaseURL(type, url),
  }
  return {
    ...props,
    ...actions,
    hydrated: store.hydrated,
  }
}
