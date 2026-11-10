// 账号快照共享契约（主进程 AccountStore ↔ 渲染层 useAccounts 缓存）
export interface AccountSnapshot {
  accounts: Account[]
  currentAccountId: string
}

export const DEFAULT_ACCOUNT_SNAPSHOT: AccountSnapshot = {
  accounts: [{ id: 'default', name: '默认账号' }],
  currentAccountId: 'default',
}

export type AccountAction =
  | { ok: true; snapshot: AccountSnapshot }
  | { ok: false; reason: 'invalid' | 'duplicate' | 'last-account' | 'io' }
