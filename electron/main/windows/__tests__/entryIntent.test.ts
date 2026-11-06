import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SHELL_PLATFORM_CATALOG } from '#/platforms/catalog'
import {
  ENTRY_MEMORY_VERSION,
  type EntryMemory,
  type EntrySelectionResult,
  makeEntryMemory,
  resolveEntrySelection,
  shouldAutoRestore,
} from '#/windows/entryIntent'

// ===== 入口意图裁决纯函数契约（shell-entry-platform-selector v1 · Proposed Changes 2）=====
// 决策表一（resolveEntrySelection）：合法 / 未知 / 不支持的平台 × shell 开关；
// 决策表二（shouldAutoRestore）：无记忆 / 损坏(parse→null) / 版本不符 / autoRestore=false / 平台下架 / 非 attachSupported / 正常命中；
// 纯性断言：源码零 `from 'electron'`（本模块必须可在无 Electron 的 vitest 里直接决策表测试）。

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const entryFixture = (over: Partial<ShellPlatformEntry>): ShellPlatformEntry => ({
  id: 'douyin',
  label: '抖店',
  description: '测试替身',
  category: 'douyin',
  attachSupported: true,
  icon: 'douyin',
  ...over,
})

const memoryFixture = (over: Partial<EntryMemory> = {}): EntryMemory => ({
  version: ENTRY_MEMORY_VERSION,
  lastPlatform: 'douyin',
  autoRestore: true,
  updatedAt: '2026-11-06T12:00:00.000Z',
  ...over,
})

describe('resolveEntrySelection 选择决策表（TC-I1~I2）', () => {
  type Case = [
    name: string,
    platform: string,
    catalog: readonly ShellPlatformEntry[],
    shellUiEnabled: boolean,
    expected: EntrySelectionResult,
  ]

  const cases: Case[] = [
    [
      '合法 douyin + shell 开',
      'douyin',
      SHELL_PLATFORM_CATALOG,
      true,
      { ok: true, entry: SHELL_PLATFORM_CATALOG[0] },
    ],
    [
      '合法 buyin + shell 开',
      'buyin',
      SHELL_PLATFORM_CATALOG,
      true,
      { ok: true, entry: SHELL_PLATFORM_CATALOG[1] },
    ],
    [
      '合法 eos + shell 开',
      'eos',
      SHELL_PLATFORM_CATALOG,
      true,
      { ok: true, entry: SHELL_PLATFORM_CATALOG[2] },
    ],
    [
      '未知平台（合法枚举但未收录）',
      'kuaishou',
      SHELL_PLATFORM_CATALOG,
      true,
      {
        ok: false,
        reason: 'unknown',
      },
    ],
    ['统一空平台串', '', SHELL_PLATFORM_CATALOG, true, { ok: false, reason: 'unknown' }],
    ['脏输入大小写不符', 'Douyin', SHELL_PLATFORM_CATALOG, true, { ok: false, reason: 'unknown' }],
    ['目录为空', 'douyin', [], true, { ok: false, reason: 'unknown' }],
    [
      '收录但不支持 attach → unsupported',
      'douyin',
      [entryFixture({ attachSupported: false })],
      true,
      { ok: false, reason: 'unsupported' },
    ],
    [
      'shell 关闭 + 合法平台 → shell-disabled',
      'douyin',
      SHELL_PLATFORM_CATALOG,
      false,
      { ok: false, reason: 'shell-disabled' },
    ],
    [
      'shell 关闭 + 未知平台 → shell-disabled（优先级最高）',
      'kuaishou',
      SHELL_PLATFORM_CATALOG,
      false,
      { ok: false, reason: 'shell-disabled' },
    ],
  ]

  for (const [name, platform, catalog, shellUiEnabled, expected] of cases) {
    it(`TC-I1 [${name}]`, () => {
      expect(resolveEntrySelection(platform, catalog, shellUiEnabled)).toEqual(expected)
    })
  }

  it('TC-I2 [注入目录] 裁决只依赖传入目录，不写死内置目录（测试替身目录同样生效）', () => {
    const custom = [entryFixture({ id: 'dev', label: '开发' })]
    const hit = resolveEntrySelection('dev', custom, true)
    expect(hit.ok).toBe(true)
    if (hit.ok) expect(hit.entry).toBe(custom[0])
    // 内置目录中存在的平台在替身目录里不存在 → unknown（证明未回退内置真源）
    expect(resolveEntrySelection('douyin', custom, true)).toEqual({
      ok: false,
      reason: 'unknown',
    })
  })
})

describe('EntryMemory 构造与版本（TC-I3）', () => {
  it('TC-I3a [makeEntryMemory] version/平台/开关/updatedAt 与注入 now 一致', () => {
    const now = new Date('2026-11-06T12:00:00.000Z')
    expect(makeEntryMemory('buyin', true, now)).toEqual({
      version: ENTRY_MEMORY_VERSION,
      lastPlatform: 'buyin',
      autoRestore: true,
      updatedAt: '2026-11-06T12:00:00.000Z',
    })
  })

  it('TC-I3b [makeEntryMemory] autoRestore=false 保留（跳过自动进入），updatedAt 可被 Date.parse', () => {
    const memory = makeEntryMemory('eos', false, new Date('2026-01-02T03:04:05.006Z'))
    expect(memory.autoRestore).toBe(false)
    expect(Number.isNaN(Date.parse(memory.updatedAt))).toBe(false)
  })

  it('TC-I3c [makeEntryMemory] 默认 now = 当前时间（区间断言，不 sleep）', () => {
    const before = Date.now()
    const memory = makeEntryMemory('douyin', true)
    const after = Date.now()
    const ts = Date.parse(memory.updatedAt)
    expect(memory.version).toBe(1)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

describe('shouldAutoRestore 自动恢复决策表（TC-I4~I6）', () => {
  type Case = [name: string, memory: EntryMemory | null, expected: LiveControlPlatform | null]

  const cases: Case[] = [
    ['无记忆 → null', null, null],
    ['版本不符（v2）→ null', memoryFixture({ version: 2 }), null],
    ['版本不符（v0）→ null', memoryFixture({ version: 0 }), null],
    ['autoRestore=false → null', memoryFixture({ autoRestore: false }), null],
    ['平台下架（kuaishou 未收录）→ null', memoryFixture({ lastPlatform: 'kuaishou' }), null],
    ['空平台串 → null', memoryFixture({ lastPlatform: '' }), null],
    ['正常命中 douyin → douyin', memoryFixture({ lastPlatform: 'douyin' }), 'douyin'],
    ['正常命中 buyin → buyin', memoryFixture({ lastPlatform: 'buyin' }), 'buyin'],
    ['正常命中 eos → eos', memoryFixture({ lastPlatform: 'eos' }), 'eos'],
  ]

  for (const [name, memory, expected] of cases) {
    it(`TC-I4 [${name}]`, () => {
      expect(shouldAutoRestore(memory, SHELL_PLATFORM_CATALOG)).toBe(expected)
    })
  }

  it('TC-I5 [能力门禁] 目录收录但 attachSupported=false → 不自动恢复', () => {
    const catalog = [entryFixture({ id: 'douyin', attachSupported: false })]
    expect(shouldAutoRestore(memoryFixture({ lastPlatform: 'douyin' }), catalog)).toBeNull()
  })

  it('TC-I6 [注入目录] 空目录 / 替身目录：只按传入目录裁决', () => {
    expect(shouldAutoRestore(memoryFixture(), [])).toBeNull()
    const custom = [entryFixture({ id: 'dev' })]
    expect(shouldAutoRestore(memoryFixture({ lastPlatform: 'dev' }), custom)).toBe('dev')
  })
})

describe('纯性契约（TC-I7）', () => {
  it('TC-I7 [零 Electron import] entryIntent 源码不得 import electron（可脱离 Electron 测试/复用）', () => {
    const source = fs.readFileSync(path.join(root, 'main/windows/entryIntent.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"]electron['"]/)
    expect(source).not.toMatch(/require\(\s*['"]electron['"]\s*\)/)
  })
})
