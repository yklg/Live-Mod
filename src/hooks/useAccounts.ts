import { useEffect } from 'react'
import type { AccountSnapshot } from 'shared/accounts'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { EVENTS, eventEmitter } from '@/utils/events'

interface Account {
  id: string
  name: string
}

interface AccountsStore {
  accounts: Account[]
  currentAccountId: string
  hydrated: boolean
  addAccount: (name: string) => Promise<boolean>
  removeAccount: (id: string) => Promise<boolean>
  switchAccount: (id: string) => Promise<boolean>
  updateAccountName: (id: string, name: string) => Promise<boolean>
  getCurrentAccount: () => Account | undefined
}

const DEFAULT_ACCOUNTS: Account[] = [{ id: 'default', name: '默认账号' }]

const store = create<AccountsStore>()(
  immer((set, get) => {
    const apply = (snapshot: AccountSnapshot) => {
      set(state => {
        state.accounts = snapshot.accounts
        state.currentAccountId = snapshot.currentAccountId
        state.hydrated = true
      })
    }

    return {
      accounts: DEFAULT_ACCOUNTS,
      currentAccountId: 'default',
      hydrated: false,

      addAccount: async (name: string) => {
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.account.add, name)
        if (!result.ok) return false
        apply(result.snapshot)
        const added = result.snapshot.accounts.find(a => a.name === name.trim())
        if (added) eventEmitter.emit(EVENTS.ACCOUNT_ADDED, added.id, added.name)
        return true
      },

      removeAccount: async (id: string) => {
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.account.remove, id)
        if (!result.ok) return false
        apply(result.snapshot)
        eventEmitter.emit(EVENTS.ACCOUNT_REMOVED, id)
        return true
      },

      switchAccount: async (id: string) => {
        if (id === get().currentAccountId) return true
        const account = get().accounts.find(a => a.id === id)
        if (!account) return false
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.account.switch, { account })
        if (!result.ok) return false
        apply(result.snapshot)
        eventEmitter.emit(EVENTS.ACCOUNT_SWITCHED, id)
        return true
      },

      updateAccountName: async (id: string, name: string) => {
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.account.rename, id, name)
        if (!result.ok) return false
        apply(result.snapshot)
        return true
      },

      getCurrentAccount: () => {
        return get().accounts.find(acc => acc.id === get().currentAccountId)
      },
    }
  }),
)

let hydration: Promise<void> | null = null
let listenerInstalled = false

function readLegacy(): unknown {
  try {
    const raw = localStorage.getItem('accounts-storage')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function ensureAccountsHydrated(): Promise<void> {
  if (hydration) return hydration
  hydration = (async () => {
    if (!listenerInstalled) {
      listenerInstalled = true
      window.ipcRenderer.on(IPC_CHANNELS.account.updated, snapshot => {
        store.setState(state => {
          state.accounts = snapshot.accounts
          state.currentAccountId = snapshot.currentAccountId
          state.hydrated = true
        })
      })
    }
    const legacy = readLegacy()
    const snapshot: AccountSnapshot = legacy
      ? await window.ipcRenderer.invoke(IPC_CHANNELS.account.migrate, legacy)
      : await window.ipcRenderer.invoke(IPC_CHANNELS.account.get)
    store.setState(state => {
      state.accounts = snapshot.accounts
      state.currentAccountId = snapshot.currentAccountId
      state.hydrated = true
    })
  })().catch(() => {
    // 主进程不可用：保留默认账号，hydrated 保持 false，任务门禁会拦住
    store.setState(state => {
      state.hydrated = false
    })
  })
  return hydration
}

/** 兼容既有 hook 形态；首次调用触发一次主进程快照同步（幂等）。 */
export function useAccounts(): AccountsStore
export function useAccounts<T>(selector: (state: AccountsStore) => T): T
export function useAccounts<T>(selector?: (state: AccountsStore) => T): T | AccountsStore {
  useEffect(() => {
    void ensureAccountsHydrated()
  }, [])
  return selector ? store(selector) : store()
}
