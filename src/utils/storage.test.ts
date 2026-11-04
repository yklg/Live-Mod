import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pkg from '../../package.json'

// ===== 测试基础设施 =====
// DEPRECATED_STORAGE_KEYS 在 storage.ts 模块加载时基于当时 localStorage 内容一次性捕获，
// 因此每个用例先铺好 localStorage，再通过 vi.resetModules() + 动态 import 重新求值被测模块。

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

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadStorageModule() {
  vi.resetModules()
  return import('./storage')
}

describe('storage 存储清理机制（TC-01 ~ TC-05）', () => {
  it('TC-01 [MIG-01] 版本号未变化时不执行任何清理', async () => {
    localStorage.setItem('legacy-old-key', 'keep-me')
    localStorage.setItem('storage-version', pkg.version)

    const { autoCleanupStorage } = await loadStorageModule()
    autoCleanupStorage()

    expect(localStorage.getItem('legacy-old-key')).toBe('keep-me')
    expect(localStorage.getItem('storage-version')).toBe(pkg.version)
  })

  it('TC-02 [MIG-01] 版本升级时清理废弃键，白名单键全部幸存（含 F1 回归防线：red-packet-storage）', async () => {
    localStorage.setItem('accounts-storage', '{"state":{"accounts":[]}}')
    localStorage.setItem('red-packet-storage', '{"state":{"cooldownSeconds":60}}')
    localStorage.setItem('appearance-storage', '{"state":{"mode":"dark"}}')
    localStorage.setItem('log-panel-storage', '{"state":{"collapsed":true}}')
    localStorage.setItem('legacy-old-key', 'delete-me')
    localStorage.setItem('storage-version', '0.0.0') // 模拟旧版本号

    const { autoCleanupStorage } = await loadStorageModule()
    autoCleanupStorage()

    expect(localStorage.getItem('legacy-old-key')).toBeNull()
    // 以下均为白名单键，升级后必须幸存
    expect(localStorage.getItem('accounts-storage')).not.toBeNull()
    expect(localStorage.getItem('red-packet-storage')).toBe('{"state":{"cooldownSeconds":60}}')
    expect(localStorage.getItem('appearance-storage')).not.toBeNull()
    expect(localStorage.getItem('log-panel-storage')).not.toBeNull()
  })

  it('TC-03 [CT-01] 源码中所有 zustand persist 存储键均已注册进 STORAGE_KEYS 白名单', async () => {
    const { STORAGE_KEYS } = await loadStorageModule()
    const whitelist = new Set<string>(Object.values(STORAGE_KEYS))

    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue
        const content = fs.readFileSync(full, 'utf8')
        if (!content.includes('persist(')) continue
        // 只匹配 persist 配置形态：name 后紧跟 version/storage/partialize/merge/migrate，
        // 过滤同文件内的业务字段（如 useAccounts 的 name: '默认账号'）
        for (const match of content.matchAll(
          /name:\s*'([^']+)'\s*,\s*\n?\s*(version|storage|partialize|merge|migrate)\b/g,
        )) {
          if (!whitelist.has(match[1])) {
            offenders.push(`${path.relative(srcDir, full)} → '${match[1]}'`)
          }
        }
      }
    }
    walk(srcDir)

    expect(offenders).toEqual([])
  })

  it('TC-04 [CFG-01] localStorage 数据损坏时安全返回 undefined 而不抛错', async () => {
    localStorage.setItem('auto-message-storage', '{invalid json')

    const { getAccountData, removeAccountData } = await loadStorageModule()

    expect(() => getAccountData('auto-message-storage', 'default')).not.toThrow()
    expect(getAccountData('auto-message-storage', 'default')).toBeUndefined()
    expect(() => removeAccountData('auto-message-storage', 'default')).not.toThrow()
  })

  it('TC-05 [DATA-01] 清理指定账号只删除该账号数据，default 账号受保护', async () => {
    const seed = (contexts: Record<string, unknown>) => JSON.stringify({ state: { contexts } })
    localStorage.setItem(
      'auto-message-storage',
      seed({ acc1: { rows: [1] }, acc2: { rows: [2] }, default: { rows: [0] } }),
    )
    localStorage.setItem('live-control-storage', seed({ acc1: { connected: true } }))

    const { clearAccountStorage } = await loadStorageModule()

    clearAccountStorage('acc1')

    const autoMessage = JSON.parse(localStorage.getItem('auto-message-storage') as string)
    expect(autoMessage.state.contexts.acc1).toBeUndefined()
    expect(autoMessage.state.contexts.acc2).toEqual({ rows: [2] })
    expect(autoMessage.state.contexts.default).toEqual({ rows: [0] })

    const liveControl = JSON.parse(localStorage.getItem('live-control-storage') as string)
    expect(liveControl.state.contexts.acc1).toBeUndefined()

    // default 账号不允许被清理
    clearAccountStorage('default')
    const after = JSON.parse(localStorage.getItem('auto-message-storage') as string)
    expect(after.state.contexts.default).toEqual({ rows: [0] })
  })
})
