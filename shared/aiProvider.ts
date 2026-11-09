// AI 配置的跨进程共享类型与默认值（renderer / main 共用）。
// 这是单一 schema 源：主进程 AIProviderStore 持久化它，渲染层 useAIProvider 只做 IPC 缓存。
import { providers } from './providers'

export type AIProvider = string
export type APIKeys = Record<AIProvider, string>
export type AIConfigType = 'chat' | 'autoReply'

export interface ProviderConfig {
  provider: AIProvider
  model: string
  modelPreferences: Record<AIProvider, string>
}

export interface AIConfig {
  config: ProviderConfig
  apiKeys: APIKeys
  customBaseURL: string
}

export interface AIProviderState {
  chat: AIConfig
  autoReply: AIConfig
}

export interface AIProviderPatch {
  config?: Partial<ProviderConfig>
  apiKey?: { provider: string; key: string }
  customBaseURL?: string
}

export interface AIProviderSetPayload {
  type: AIConfigType
  patch: AIProviderPatch
}

/** 合并 provider/model patch：provider 切换时优先用该 provider 上次记住的模型。 */
export function applyProviderConfigPatch(
  current: ProviderConfig,
  patch: Partial<ProviderConfig>,
): ProviderConfig {
  const next: ProviderConfig = {
    provider: current.provider,
    model: current.model,
    modelPreferences: { ...current.modelPreferences },
  }
  if (patch.provider) {
    const model = patch.model || next.modelPreferences[patch.provider] || current.model
    next.provider = patch.provider
    next.model = model
    next.modelPreferences[patch.provider] = model
  } else if (patch.model) {
    next.model = patch.model
    next.modelPreferences[next.provider] = patch.model
  }
  return next
}

export function createDefaultProviderConfig(): ProviderConfig {
  const modelPreferences = Object.keys(providers).reduce<Record<string, string>>(
    (acc, provider) => {
      acc[provider] = providers[provider].models[0] || ''
      return acc
    },
    {},
  )
  return {
    provider: 'deepseek',
    model: providers.deepseek.models[0],
    modelPreferences,
  }
}

export function createDefaultApiKeys(): APIKeys {
  return Object.keys(providers).reduce<APIKeys>((acc, provider) => {
    acc[provider] = ''
    return acc
  }, {})
}

export function createDefaultAIConfig(): AIConfig {
  return {
    config: createDefaultProviderConfig(),
    apiKeys: createDefaultApiKeys(),
    customBaseURL: '',
  }
}

export function createDefaultAIProviderState(): AIProviderState {
  return { chat: createDefaultAIConfig(), autoReply: createDefaultAIConfig() }
}
