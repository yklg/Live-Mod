import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDefaultAIProviderState } from 'shared/aiProvider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_PROVIDER_STORE_FILE,
  AI_PROVIDER_STORE_VERSION,
  applyAIProviderPatch,
  getAIProviderStorePath,
  importLegacyAIProviderState,
  loadAIProviderState,
  parseStoredAIProviderState,
  type StoredAIProviderState,
  saveAIProviderState,
  serializeAIProviderState,
} from '#/services/AIProviderStore'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

const stored = (over: Partial<StoredAIProviderState> = {}): StoredAIProviderState => ({
  version: AI_PROVIDER_STORE_VERSION,
  migrated: true,
  ...createDefaultAIProviderState(),
  ...over,
})

let tmpDir: string
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-mod-ai-provider-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('parse/serialize（损坏/缺省/单 context 回退）', () => {
  it('TC-AP1 [往返] serialize → parse 恒等', () => {
    const value = stored()
    expect(parseStoredAIProviderState(serializeAIProviderState(value))).toEqual(value)
  })

  it('TC-AP2 [损坏] 非法 JSON/版本/迁移标记 → null', () => {
    for (const raw of [null, '', 'bad', '[]', '42']) {
      expect(parseStoredAIProviderState(raw)).toBeNull()
    }
    expect(parseStoredAIProviderState(JSON.stringify({ ...stored(), version: 2 }))).toBeNull()
    expect(parseStoredAIProviderState(JSON.stringify({ ...stored(), migrated: 'yes' }))).toBeNull()
  })

  it('TC-AP3 [单 context 损坏] 只回退坏的那一侧，保留另一侧', () => {
    const value = stored()
    value.chat.config.provider = 'broken-provider'
    const parsed = parseStoredAIProviderState(
      JSON.stringify({ ...value, autoReply: { ...value.autoReply, config: { nope: 1 } } }),
    )
    expect(parsed?.chat.config.provider).toBe('broken-provider')
    expect(parsed?.autoReply.config.provider).toBe('deepseek')
  })
})

describe('applyAIProviderPatch（per-context 隔离）', () => {
  it('TC-AP4 改 chat 的 provider/model 不覆盖 autoReply', () => {
    const base = createDefaultAIProviderState()
    base.autoReply.config.provider = 'openrouter'
    base.autoReply.config.model = 'keep-me'
    const next = applyAIProviderPatch(base, 'chat', {
      config: { provider: 'siliconflow', model: 'chat-model' },
    })
    expect(next.chat.config.provider).toBe('siliconflow')
    expect(next.chat.config.model).toBe('chat-model')
    expect(next.autoReply.config.provider).toBe('openrouter')
    expect(next.autoReply.config.model).toBe('keep-me')
  })

  it('TC-AP5 改 chat 的 API Key 不覆盖 autoReply', () => {
    const base = createDefaultAIProviderState()
    const next = applyAIProviderPatch(base, 'chat', {
      apiKey: { provider: 'deepseek', key: 'sk-chat' },
    })
    expect(next.chat.apiKeys.deepseek).toBe('sk-chat')
    expect(next.autoReply.apiKeys.deepseek).toBe('')
  })

  it('TC-AP6 customBaseURL 只改目标 context', () => {
    const next = applyAIProviderPatch(createDefaultAIProviderState(), 'autoReply', {
      customBaseURL: 'https://proxy.example',
    })
    expect(next.autoReply.customBaseURL).toBe('https://proxy.example')
    expect(next.chat.customBaseURL).toBe('')
  })
})

describe('load/save/migrate/path', () => {
  it('TC-AP7 [缺失] → 默认且 migrated=false', () => {
    const loaded = loadAIProviderState({ path: path.join(tmpDir, 'nope.json') })
    expect(loaded.migrated).toBe(false)
    expect(loaded.chat.config.provider).toBe('deepseek')
  })

  it('TC-AP8 [默认 fs 集成] save → load 往返', () => {
    const file = path.join(tmpDir, AI_PROVIDER_STORE_FILE)
    const value = stored()
    value.chat.apiKeys.deepseek = 'sk-1'
    expect(saveAIProviderState(value, { path: file })).toBe(true)
    expect(loadAIProviderState({ path: file })).toEqual(value)
  })

  it('TC-AP9 [迁移] 旧状态只填合法字段，坏 context 回默认', () => {
    const migrated = importLegacyAIProviderState({
      chat: {
        config: { provider: 'deepseek', model: 'm', modelPreferences: { deepseek: 'm' } },
        apiKeys: { deepseek: 'k' },
        customBaseURL: '',
      },
      autoReply: { nope: true },
    })
    expect(migrated.chat.apiKeys.deepseek).toBe('k')
    expect(migrated.autoReply.config.provider).toBe('deepseek')
  })

  it('TC-AP10 [路径/写异常]', () => {
    expect(AI_PROVIDER_STORE_FILE).toBe('ai-provider.json')
    expect(getAIProviderStorePath()).toBe(path.join('/mock/userData', AI_PROVIDER_STORE_FILE))
    const writeFile = () => {
      throw new Error('EROFS')
    }
    expect(() => saveAIProviderState(stored(), { path: '/x/a.json', writeFile })).not.toThrow()
    expect(saveAIProviderState(stored(), { path: '/x/a.json', writeFile })).toBe(false)
  })
})
