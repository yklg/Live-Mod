import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_STORE_FILE, AccountStore, parseAccountSnapshot } from '#/services/AccountStore'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getAppPath: vi.fn(() => '/mock/app'),
  },
}))

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-account-store-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const make = () => new AccountStore({ path: path.join(dir, ACCOUNT_STORE_FILE) })

describe('AccountStore 基本操作', () => {
  it('默认账号；add/rename/switch/remove', () => {
    const s = make()
    expect(s.snapshot()).toEqual({
      accounts: [{ id: 'default', name: '默认账号' }],
      currentAccountId: 'default',
    })
    const added = s.add('  小店 A  ')
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const id = added.snapshot.accounts[1].id
    expect(added.snapshot.accounts[1].name).toBe('小店 A')
    expect(s.rename(id, '小店 B').ok).toBe(true)
    expect(s.switch(id).ok).toBe(true)
    expect(s.snapshot().currentAccountId).toBe(id)
    expect(s.remove(id).ok).toBe(true)
    expect(s.snapshot().currentAccountId).toBe('default')
  })

  it('重复名/空名/默认账号删除/末账号拒绝', () => {
    const s = make()
    expect(s.add('  ').ok).toBe(false)
    expect(s.add('默认账号').ok).toBe(false)
    expect(s.remove('default').ok).toBe(false)
    expect(s.remove('missing').ok).toBe(false)
    expect(s.switch('missing').ok).toBe(false)
  })

  it('持久化往返；损坏主文件回 .bak', () => {
    const file = path.join(dir, ACCOUNT_STORE_FILE)
    const s = make()
    s.add('A')
    const snapshot = s.snapshot()
    const reloaded = make().snapshot()
    expect(reloaded).toEqual(snapshot)

    fs.writeFileSync(`${file}.bak`, fs.readFileSync(file, 'utf-8'))
    fs.writeFileSync(file, '{broken')
    const healed = make().snapshot()
    expect(healed).toEqual(snapshot)
  })

  it('迁移 zustand persist 形状；migrated 幂等', () => {
    const s = make()
    const legacy = {
      state: {
        accounts: [
          { id: 'default', name: '默认账号' },
          { id: 'a1', name: '账号一' },
        ],
        currentAccountId: 'a1',
      },
      version: 2,
    }
    const migrated = s.migrate(legacy)
    expect(migrated.accounts).toHaveLength(2)
    expect(migrated.currentAccountId).toBe('a1')
    expect(s.isMigrated()).toBe(true)
    const again = s.migrate({ state: { accounts: [{ id: 'x', name: 'x' }] } })
    expect(again).toEqual(migrated)
  })

  it('非法迁移输入回默认并标记 migrated', () => {
    const s = make()
    expect(s.migrate('nope').accounts[0].id).toBe('default')
    expect(s.isMigrated()).toBe(true)
  })

  it('写入失败返回 io，不抛', () => {
    const s = new AccountStore({
      path: path.join(dir, ACCOUNT_STORE_FILE),
      writeFile: () => {
        throw new Error('EROFS')
      },
    })
    expect(s.add('A')).toEqual({ ok: false, reason: 'io' })
  })

  it('parseAccountSnapshot 拒绝非法结构', () => {
    expect(parseAccountSnapshot(null)).toBeNull()
    expect(parseAccountSnapshot({ accounts: [], currentAccountId: 'x' })).toBeNull()
    expect(
      parseAccountSnapshot({ accounts: [{ id: 'a', name: 'A' }], currentAccountId: 'b' }),
    ).toBeNull()
    expect(
      parseAccountSnapshot({ accounts: [{ id: 'a', name: 'A' }], currentAccountId: 'a' }),
    ).toEqual({
      accounts: [{ id: 'a', name: 'A' }],
      currentAccountId: 'a',
    })
  })
})
