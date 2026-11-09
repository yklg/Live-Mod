// 账号单一源（userData/accounts.json）· 第二期
// 渲染层 useAccounts 只是 IPC 缓存；主进程这里是唯一持久化与迁移入口。
// 旧 localStorage('accounts-storage') 只做一次性迁移输入，不再作为运行时源。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { type AccountAction, type AccountSnapshot, DEFAULT_ACCOUNT_SNAPSHOT } from 'shared/accounts'
import { createLogger } from '#/logger'

export const ACCOUNT_STORE_FILE = 'accounts.json'
export const ACCOUNT_STORE_VERSION = 2

interface StoredAccountState extends AccountSnapshot {
  version: number
  migrated: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseAccounts(value: unknown): Account[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: Account[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return null
    if (!item.id || !item.name.trim()) return null
    if (out.some(a => a.id === item.id)) return null
    out.push({ id: item.id, name: item.name })
  }
  return out
}

/** 纯解析：文件/迁移输入 → snapshot；非法返回 null。 */
export function parseAccountSnapshot(value: unknown): AccountSnapshot | null {
  if (!isRecord(value)) return null
  // 兼容 zustand persist 包装 {state: {...}}
  const source = isRecord(value.state) ? value.state : value
  const accounts = parseAccounts(source.accounts)
  if (!accounts) return null
  const currentAccountId = source.currentAccountId
  if (typeof currentAccountId !== 'string') return null
  if (!accounts.some(a => a.id === currentAccountId)) return null
  return { accounts, currentAccountId }
}

function parseStored(raw: string | null): StoredAccountState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  const version = data.version
  if (version !== 1 && version !== ACCOUNT_STORE_VERSION) return null
  const snapshot = parseAccountSnapshot(data)
  if (!snapshot) return null
  return { version: ACCOUNT_STORE_VERSION, migrated: data.migrated === true, ...snapshot }
}

export interface AccountStoreOptions {
  path?: string
  readFile?: (p: string) => string | null
  writeFile?: (p: string, data: string) => void
  backup?: (p: string) => void
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }
}

export class AccountStore {
  private state: StoredAccountState
  private loaded = false
  private readonly filePath: string
  private readonly readFile: (p: string) => string | null
  private readonly writeFile: (p: string, data: string) => void
  private readonly backup: (p: string) => void
  private readonly log: NonNullable<AccountStoreOptions['logger']>

  constructor(opts: AccountStoreOptions = {}) {
    this.filePath = opts.path ?? path.join(app.getPath('userData'), ACCOUNT_STORE_FILE)
    this.readFile =
      opts.readFile ??
      (p => {
        try {
          return fs.readFileSync(p, 'utf-8')
        } catch {
          return null
        }
      })
    this.writeFile =
      opts.writeFile ??
      ((p, data) => {
        const tmp = `${p}.tmp`
        fs.writeFileSync(tmp, data, 'utf-8')
        fs.renameSync(tmp, p)
      })
    this.backup =
      opts.backup ??
      (p => {
        try {
          if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`)
        } catch {
          // 备份失败不阻断写入；损坏时回默认
        }
      })
    this.log = opts.logger ?? createLogger('AccountStore')
    this.state = {
      version: ACCOUNT_STORE_VERSION,
      migrated: false,
      ...DEFAULT_ACCOUNT_SNAPSHOT,
    }
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    const raw = parseStored(this.readFile(this.filePath))
    if (raw) {
      this.state = raw
      return
    }
    // 主文件损坏：尝试 .bak
    const backup = parseStored(this.readFile(`${this.filePath}.bak`))
    if (backup) {
      this.state = backup
      this.log.warn('accounts.json 损坏，已回退 .bak')
    }
  }

  snapshot(): AccountSnapshot {
    this.load()
    return {
      accounts: this.state.accounts.map(a => ({ ...a })),
      currentAccountId: this.state.currentAccountId,
    }
  }

  isMigrated(): boolean {
    this.load()
    return this.state.migrated
  }

  private commit(next: StoredAccountState): AccountAction {
    try {
      this.backup(this.filePath)
      this.writeFile(this.filePath, JSON.stringify(next, null, 2))
      this.state = next
      return { ok: true, snapshot: this.snapshot() }
    } catch (e) {
      this.log.warn('账号写入失败：', e)
      return { ok: false, reason: 'io' }
    }
  }

  migrate(legacy: unknown): AccountSnapshot {
    this.load()
    if (this.state.migrated) return this.snapshot()
    const parsed = parseAccountSnapshot(legacy)
    if (!parsed) {
      // 迁移失败也标记，避免每次启动重复尝试；保留默认账号
      const next = { ...this.state, migrated: true }
      this.commit(next)
      return this.snapshot()
    }
    const next: StoredAccountState = {
      version: ACCOUNT_STORE_VERSION,
      migrated: true,
      ...parsed,
    }
    const result = this.commit(next)
    if (!result.ok) this.log.warn('账号迁移写入失败，使用内存快照')
    else this.state = next
    return this.snapshot()
  }

  add(name: string): AccountAction {
    this.load()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: 'invalid' }
    if (this.state.accounts.some(a => a.name === trimmed)) return { ok: false, reason: 'duplicate' }
    const next: StoredAccountState = {
      ...this.state,
      accounts: [...this.state.accounts, { id: crypto.randomUUID(), name: trimmed }],
    }
    return this.commit(next)
  }

  remove(accountId: string): AccountAction {
    this.load()
    if (accountId === 'default') return { ok: false, reason: 'invalid' }
    if (this.state.accounts.length <= 1) return { ok: false, reason: 'last-account' }
    const accounts = this.state.accounts.filter(a => a.id !== accountId)
    if (accounts.length === this.state.accounts.length) return { ok: false, reason: 'invalid' }
    const currentAccountId =
      this.state.currentAccountId === accountId ? 'default' : this.state.currentAccountId
    return this.commit({ ...this.state, accounts, currentAccountId })
  }

  switch(accountId: string): AccountAction {
    this.load()
    if (!this.state.accounts.some(a => a.id === accountId)) {
      return { ok: false, reason: 'invalid' }
    }
    if (accountId === this.state.currentAccountId) {
      return { ok: true, snapshot: this.snapshot() }
    }
    return this.commit({ ...this.state, currentAccountId: accountId })
  }

  rename(accountId: string, name: string): AccountAction {
    this.load()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: 'invalid' }
    if (this.state.accounts.some(a => a.id !== accountId && a.name === trimmed)) {
      return { ok: false, reason: 'duplicate' }
    }
    const accounts = this.state.accounts.map(a =>
      a.id === accountId ? { ...a, name: trimmed } : a,
    )
    if (!accounts.some(a => a.id === accountId)) return { ok: false, reason: 'invalid' }
    return this.commit({ ...this.state, accounts })
  }
}

export const accountStore = new AccountStore()
