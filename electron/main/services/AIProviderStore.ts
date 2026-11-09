// AI 配置单一源（userData/ai-provider.json）
// 渲染层 useAIProvider 只是 IPC 缓存；主进程这里是唯一持久化与合并真源。
// 旧 localStorage('ai-chat-storage') 只做一次性迁移输入，不再作为运行时配置源。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  type AIConfig,
  type AIConfigType,
  type AIProviderPatch,
  type AIProviderState,
  type APIKeys,
  applyProviderConfigPatch,
  createDefaultAIConfig,
  createDefaultAIProviderState,
  type ProviderConfig,
} from 'shared/aiProvider'

export const AI_PROVIDER_STORE_FILE = 'ai-provider.json'
export const AI_PROVIDER_STORE_VERSION = 1

export interface StoredAIProviderState extends AIProviderState {
  version: number
  migrated: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null
    out[key] = entry
  }
  return out
}

function parseProviderConfig(value: unknown): ProviderConfig | null {
  if (!isRecord(value)) return null
  if (typeof value.provider !== 'string' || value.provider.length === 0) return null
  if (typeof value.model !== 'string') return null
  const preferences = parseStringRecord(value.modelPreferences)
  if (!preferences) return null
  return { provider: value.provider, model: value.model, modelPreferences: preferences }
}

function parseAIConfig(value: unknown): AIConfig | null {
  if (!isRecord(value)) return null
  const config = parseProviderConfig(value.config)
  if (!config) return null
  const apiKeys = parseStringRecord(value.apiKeys)
  if (!apiKeys) return null
  if (typeof value.customBaseURL !== 'string') return null
  return { config, apiKeys: apiKeys as APIKeys, customBaseURL: value.customBaseURL }
}

/** 严格解析文件：损坏/版本不符 → null；单个 context 损坏 → 该 context 回默认。 */
export function parseStoredAIProviderState(raw: string | null): StoredAIProviderState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  if (data.version !== AI_PROVIDER_STORE_VERSION) return null
  if (typeof data.migrated !== 'boolean') return null
  const chat = parseAIConfig(data.chat) ?? createDefaultAIConfig()
  const autoReply = parseAIConfig(data.autoReply) ?? createDefaultAIConfig()
  return {
    version: AI_PROVIDER_STORE_VERSION,
    migrated: data.migrated,
    chat,
    autoReply,
  }
}

export function serializeAIProviderState(state: StoredAIProviderState): string {
  return JSON.stringify(state, null, 2)
}

export function getAIProviderStorePath(): string {
  return path.join(app.getPath('userData'), AI_PROVIDER_STORE_FILE)
}

const defaultReadFile = (filePath: string): string => fs.readFileSync(filePath, 'utf-8')
const defaultWriteFile = (filePath: string, data: string): void => {
  fs.writeFileSync(filePath, data, 'utf-8')
}

export function loadAIProviderState(
  opts: { path?: string; readFile?: (p: string) => string | null } = {},
): StoredAIProviderState {
  try {
    const filePath = opts.path ?? getAIProviderStorePath()
    const readFile = opts.readFile ?? defaultReadFile
    return (
      parseStoredAIProviderState(readFile(filePath)) ?? {
        version: AI_PROVIDER_STORE_VERSION,
        migrated: false,
        ...createDefaultAIProviderState(),
      }
    )
  } catch {
    return {
      version: AI_PROVIDER_STORE_VERSION,
      migrated: false,
      ...createDefaultAIProviderState(),
    }
  }
}

export function saveAIProviderState(
  state: StoredAIProviderState,
  opts: { path?: string; writeFile?: (p: string, data: string) => void } = {},
): boolean {
  try {
    const filePath = opts.path ?? getAIProviderStorePath()
    const writeFile = opts.writeFile ?? defaultWriteFile
    writeFile(filePath, serializeAIProviderState(state))
    return true
  } catch {
    return false
  }
}

/** 合并一次 set 请求；只改目标 context，另一个 context 原样保留（per-context 隔离）。 */
export function applyAIProviderPatch(
  state: AIProviderState,
  type: AIConfigType,
  patch: AIProviderPatch,
): AIProviderState {
  const next: AIProviderState = {
    chat: { ...state.chat, config: { ...state.chat.config }, apiKeys: { ...state.chat.apiKeys } },
    autoReply: {
      ...state.autoReply,
      config: {
        ...state.autoReply.config,
        modelPreferences: { ...state.autoReply.config.modelPreferences },
      },
      apiKeys: { ...state.autoReply.apiKeys },
    },
  }
  const target = next[type]
  if (patch.config) target.config = applyProviderConfigPatch(target.config, patch.config)
  if (patch.apiKey) target.apiKeys[patch.apiKey.provider] = patch.apiKey.key
  if (typeof patch.customBaseURL === 'string') target.customBaseURL = patch.customBaseURL
  return next
}

/** 旧 localStorage 迁移：允许任一 context 缺失/损坏，损坏的 context 回默认。 */
export function importLegacyAIProviderState(input: unknown): AIProviderState {
  if (!isRecord(input)) return createDefaultAIProviderState()
  return {
    chat: parseAIConfig(input.chat) ?? createDefaultAIConfig(),
    autoReply: parseAIConfig(input.autoReply) ?? createDefaultAIConfig(),
  }
}
