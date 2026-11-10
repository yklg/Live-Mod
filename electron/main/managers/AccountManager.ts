import { Result } from '@praha/byethrow'
import { ErrorFactory } from '@praha/error-factory'
import type { SessionCloseReason } from '#/errors/connectionError'
import { emitter } from '#/event/eventBus'
import { createLogger } from '#/logger'
import { AccountSession } from '#/services/AccountSession'
import { commentStore } from '#/services/commentBackend/store'

class AccountNotFoundError extends ErrorFactory({
  name: 'AccountNotFoundError',
  message: '账号不存在，请先连接中控台',
}) {}

export class AccountManager {
  accountSessions: Map<string, AccountSession> = new Map()
  accountNames: Map<string, string> = new Map()
  private logger = createLogger('账号管理')

  constructor() {
    emitter.on('page-closed', ({ accountId }) => {
      // 页面被外部关闭 ≠ 用户主动断开（壳 v3 · Wave 1 · P0-1）：
      // 前者要通知用户「连接失败」，后者必须静默。两类不得混淆。
      this.closeSession(accountId, 'page-closed')
    })
  }

  createSession(platformName: LiveControlPlatform, account: Account) {
    this.setAccountName(account.id, account.name)
    const existSession = this.accountSessions.get(account.id)
    if (existSession) {
      this.logger.warn('检测到已存在建立的连接，将关闭已建立的连接')
      // 内部重建：旧连接的中止归因为 aborted（不打扰用户）
      existSession.disconnect('internal')
    }

    const accountSession = new AccountSession(platformName, account)
    this.accountSessions.set(account.id, accountSession)
    return accountSession
  }

  getSession(accountId: string): Result.Result<AccountSession, Error> {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      return Result.fail(new AccountNotFoundError())
    }
    return Result.succeed(accountSession)
  }

  setAccountName(accountId: string, accountName: string) {
    this.accountNames.set(accountId, accountName)
  }

  getAccountName(accountId: string) {
    return this.accountNames.get(accountId) ?? '未定义账号'
  }

  /**
   * 关闭会话（壳 v3 · Wave 1 · P0-1）。
   * @param reason 关闭来源，决定在途连接的失败归因：'user'（用户主动）/ 'page-closed'（外部关页）
   */
  closeSession(accountId: string, reason: SessionCloseReason = 'user') {
    const accountSession = this.accountSessions.get(accountId)
    // 先摘登记表再清历史：disconnect 是异步的，反过来的话清理期间到达的评论会重新写进 store
    this.accountSessions.delete(accountId)
    commentStore.writer.clear(accountId)
    accountSession?.disconnect(reason)
  }

  cleanup() {
    this.accountSessions.values().forEach(session => {
      session.disconnect()
    })
  }
}

export const accountManager = new AccountManager()
