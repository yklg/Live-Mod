// 账号单一源 IPC（第二期）：所有视图读写都经这里；主进程 AccountStore 是唯一真源。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { accountManager } from '#/managers/AccountManager'
import { accountStore } from '#/services/AccountStore'
import { typedIpcMainHandle } from '#/utils'
import windowManager from '#/windowManager'

function broadcast() {
  const snapshot = accountStore.snapshot()
  windowManager.sendTo('ui', IPC_CHANNELS.account.updated, snapshot)
  return snapshot
}

function applyActiveAccount(accountId: string) {
  const snapshot = accountStore.snapshot()
  const account = snapshot.accounts.find(a => a.id === accountId)
  if (account) accountManager.setAccountName(account.id, account.name)
  void import('#/windows/shellUI').then(m => m.setActiveAccount(accountId))
}

function setupHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.account.get, () => accountStore.snapshot())
  typedIpcMainHandle(IPC_CHANNELS.account.migrate, (_, legacy) => accountStore.migrate(legacy))
  typedIpcMainHandle(IPC_CHANNELS.account.add, (_, name: string) => {
    const result = accountStore.add(name)
    if (result.ok) broadcast()
    return result
  })
  typedIpcMainHandle(IPC_CHANNELS.account.remove, (_, accountId: string) => {
    const result = accountStore.remove(accountId)
    if (result.ok) {
      accountManager.closeSession(accountId)
      void import('#/windows/shellUI').then(m => m.shellCloseAccountTab(accountId))
      applyActiveAccount(result.snapshot.currentAccountId)
      broadcast()
    }
    return result
  })
  typedIpcMainHandle(IPC_CHANNELS.account.rename, (_, accountId: string, name: string) => {
    const result = accountStore.rename(accountId, name)
    if (result.ok) broadcast()
    return result
  })
  typedIpcMainHandle(
    IPC_CHANNELS.account.switch,
    (_, params: { account?: Account; id?: string } | string) => {
      const accountId = typeof params === 'string' ? params : (params.account?.id ?? params.id)
      if (!accountId) return { ok: false as const, reason: 'invalid' as const }
      const result = accountStore.switch(accountId)
      if (result.ok) {
        applyActiveAccount(accountId)
        broadcast()
      }
      return result
    },
  )
}

export function setupAccountIpcHandlers() {
  setupHandlers()
}
