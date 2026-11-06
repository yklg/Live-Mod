import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENTRY_STORE_FILE,
  getEntryStorePath,
  loadEntryMemory,
  parseEntryMemory,
  saveEntryMemory,
  serializeEntryMemory,
} from '#/services/EntryStore'
import { ENTRY_MEMORY_VERSION, type EntryMemory } from '#/windows/entryIntent'

// 主进程无 Electron 运行时（vitest）——仅 mock getPath('userData')，其余走真实 fs（临时目录）。
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

// ===== 入口记忆持久化契约（shell-entry-platform-selector v1 · Proposed Changes 2）=====
// I-E1 serialize → parse 往返恒等（唯一 schema）；
// I-E2 损坏（非法 JSON/非对象/字段缺失/类型不符/版本不符）→ null，永不抛；
// I-E3 读异常 → null、写异常 → false（记忆丢失非功能失败，不阻断启动）；
// I-E4 io/路径可注入：默认实现 fs.readFileSync/writeFileSync，注入实现优先。

const memoryFixture = (over: Partial<EntryMemory> = {}): EntryMemory => ({
  version: ENTRY_MEMORY_VERSION,
  lastPlatform: 'douyin',
  autoRestore: true,
  updatedAt: '2026-11-06T12:00:00.000Z',
  ...over,
})

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-mod-entry-store-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('serialize / parse 往返（TC-E1~E2）', () => {
  it('TC-E1 [往返] 三平台 × autoRestore 两态：serialize → parse 恒等', () => {
    for (const platform of ['douyin', 'buyin', 'eos']) {
      for (const autoRestore of [true, false]) {
        const memory = memoryFixture({ lastPlatform: platform, autoRestore })
        expect(parseEntryMemory(serializeEntryMemory(memory))).toEqual(memory)
      }
    }
  })

  it('TC-E2 [schema] 序列化为可读 JSON 且只含四字段；parse 丢弃未知字段', () => {
    const memory = memoryFixture()
    const raw = serializeEntryMemory(memory)
    expect(raw).toContain('\n')
    expect(JSON.parse(raw)).toEqual(memory)
    const withExtra = JSON.stringify({ ...memory, legacyField: 'x' })
    expect(parseEntryMemory(withExtra)).toEqual(memory)
  })
})

describe('parseEntryMemory 损坏输入决策表（TC-E3~E5）', () => {
  it('TC-E3 [非法 JSON / 空值] null 且不抛', () => {
    const raws: Array<string | null> = [null, '', ' ', 'not-json', '{', '"str"', 'null', '[]', '42']
    for (const raw of raws) {
      expect(() => parseEntryMemory(raw)).not.toThrow()
      expect(parseEntryMemory(raw)).toBeNull()
    }
  })

  it('TC-E4 [版本不符] version ≠ 当前版本 → null（旧记忆直接失效，选择器重新出现）', () => {
    for (const version of [0, 2, 99]) {
      expect(parseEntryMemory(JSON.stringify(memoryFixture({ version })))).toBeNull()
    }
    expect(parseEntryMemory(JSON.stringify({ ...memoryFixture(), version: '1' }))).toBeNull()
  })

  it('TC-E5 [字段缺失/类型不符] 任一字段不合法 → null，不静默补默认值', () => {
    const base = memoryFixture()
    const invalid: Array<Record<string, unknown>> = [
      { lastPlatform: base.lastPlatform, autoRestore: base.autoRestore, updatedAt: base.updatedAt },
      { version: base.version, autoRestore: base.autoRestore, updatedAt: base.updatedAt },
      { version: base.version, lastPlatform: base.lastPlatform, updatedAt: base.updatedAt },
      { version: base.version, lastPlatform: base.lastPlatform, autoRestore: base.autoRestore },
      { ...base, lastPlatform: '' },
      { ...base, lastPlatform: 42 },
      { ...base, autoRestore: 'true' },
      { ...base, autoRestore: 1 },
      { ...base, updatedAt: '' },
      { ...base, updatedAt: 123 },
    ]
    for (const value of invalid) {
      expect(parseEntryMemory(JSON.stringify(value))).toBeNull()
    }
  })
})

describe('getEntryStorePath（TC-E6）', () => {
  it('TC-E6 [唯一路径] = app.getPath(userData)/shell-entry.json', () => {
    expect(ENTRY_STORE_FILE).toBe('shell-entry.json')
    expect(getEntryStorePath()).toBe(path.join('/mock/userData', ENTRY_STORE_FILE))
  })
})

describe('loadEntryMemory（TC-E7~E9）', () => {
  it('TC-E7 [注入 io] readFile 收到指定 path，返回值经 parse 校验', () => {
    const memory = memoryFixture({ lastPlatform: 'eos' })
    const readFile = vi.fn(() => serializeEntryMemory(memory))
    expect(loadEntryMemory({ path: '/x/shell-entry.json', readFile })).toEqual(memory)
    expect(readFile).toHaveBeenCalledWith('/x/shell-entry.json')
  })

  it('TC-E8 [读异常 / 无文件] → null（损坏记忆按无记忆处理，不抛）', () => {
    expect(loadEntryMemory({ path: '/x/a.json', readFile: () => null })).toBeNull()
    expect(
      loadEntryMemory({
        path: '/x/a.json',
        readFile: () => {
          throw new Error('EACCES')
        },
      }),
    ).toBeNull()
    // 默认 fs：文件不存在
    expect(loadEntryMemory({ path: path.join(tmpDir, 'nope.json') })).toBeNull()
  })

  it('TC-E9 [默认 fs 集成] save（默认写）→ load（默认读）往返恒等', () => {
    const filePath = path.join(tmpDir, ENTRY_STORE_FILE)
    const memory = memoryFixture({ lastPlatform: 'buyin', autoRestore: false })
    expect(saveEntryMemory(memory, { path: filePath })).toBe(true)
    expect(loadEntryMemory({ path: filePath })).toEqual(memory)
  })
})

describe('saveEntryMemory（TC-E10~E12）', () => {
  it('TC-E10 [注入 io] writeFile 收到 path 与序列化文本，返回 true', () => {
    const memory = memoryFixture()
    const writeFile = vi.fn<(p: string, data: string) => void>()
    expect(saveEntryMemory(memory, { path: '/x/a.json', writeFile })).toBe(true)
    expect(writeFile).toHaveBeenCalledTimes(1)
    const [calledPath, data] = writeFile.mock.calls[0]
    expect(calledPath).toBe('/x/a.json')
    expect(parseEntryMemory(data)).toEqual(memory)
  })

  it('TC-E11 [写异常] → false 且不抛（记忆丢失不阻断启动/连接）', () => {
    const writeFile = () => {
      throw new Error('EROFS')
    }
    expect(() => saveEntryMemory(memoryFixture(), { path: '/x/a.json', writeFile })).not.toThrow()
    expect(saveEntryMemory(memoryFixture(), { path: '/x/a.json', writeFile })).toBe(false)
    // 默认 fs：写到目录路径必然失败 → false
    expect(saveEntryMemory(memoryFixture(), { path: tmpDir })).toBe(false)
    // 默认 fs：父目录不存在 → false
    expect(saveEntryMemory(memoryFixture(), { path: path.join(tmpDir, 'missing/a.json') })).toBe(
      false,
    )
  })

  it('TC-E12 [默认路径] 未注入 path 时用 getEntryStorePath()', () => {
    const writeFile = vi.fn<(p: string, data: string) => void>()
    // 注入 writeFile 时 path 仍走默认实现
    expect(saveEntryMemory(memoryFixture(), { writeFile })).toBe(true)
    expect(writeFile.mock.calls[0][0]).toBe(path.join('/mock/userData', ENTRY_STORE_FILE))
  })
})
