import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 会话关闭 → 评论历史清理（W2 · TC-AC1~AC4）=====
// 守护不变量：
//   C-AC1 closeSession 必须清掉该账号的评论历史（否则重连后看到上一场直播的评论）
//   C-AC2 只清目标账号，其它账号历史与登记表不受影响
//   C-AC3 清理后快照不再包含该账号（IPC getState 的归属过滤据此生效）
//   C-AC4 closeSession 幂等：重复调用不抛错（page-closed 与手动断开可能同时触发）

vi.mock('#/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  }),
}))

vi.mock('#/services/AccountSession', () => ({ AccountSession: class {} }))

import { AccountManager } from '#/managers/AccountManager'
import { commentStore } from '#/services/commentBackend/store'

const comment = (id: string, at: number) => ({
  id,
  nickName: 'u',
  content: `c-${id}`,
  at,
})

function seed(accountId: string, ids: string[]) {
  commentStore.writer.append(
    accountId,
    ids.map((id, i) => comment(id, i)),
  )
}

const fakeSession = () => ({ disconnect: vi.fn() })

describe('会话关闭清理（TC-AC1~AC4）', () => {
  beforeEach(() => {
    commentStore.writer.clear('a')
    commentStore.writer.clear('b')
  })

  it('TC-AC1 closeSession 清掉该账号历史并调用 disconnect', () => {
    const manager = new AccountManager()
    seed('a', ['a1', 'a2'])
    const session = fakeSession()
    manager.accountSessions.set('a', session as never)

    manager.closeSession('a')

    expect(commentStore.reader.list('a')).toEqual([])
    expect(session.disconnect).toHaveBeenCalledTimes(1)
    expect(manager.accountSessions.has('a')).toBe(false)
  })

  it('TC-AC2 只清目标账号：b 的历史与登记不受影响', () => {
    const manager = new AccountManager()
    seed('a', ['a1'])
    seed('b', ['b1', 'b2'])
    manager.accountSessions.set('a', fakeSession() as never)
    manager.accountSessions.set('b', fakeSession() as never)

    manager.closeSession('a')

    expect(commentStore.reader.list('b').map(x => x.id)).toEqual(['b1', 'b2'])
    expect(manager.accountSessions.has('b')).toBe(true)
  })

  it('TC-AC3 清理后快照不再含该账号（归属过滤的数据前提）', () => {
    const manager = new AccountManager()
    seed('a', ['a1'])
    seed('b', ['b1'])
    manager.accountSessions.set('a', fakeSession() as never)

    manager.closeSession('a')

    const accounts = commentStore.reader.snapshot(100).accounts.map(x => x.accountId)
    expect(accounts).toEqual(['b'])
  })

  it('TC-AC4 closeSession 幂等：重复调用不抛错', () => {
    const manager = new AccountManager()
    seed('a', ['a1'])
    manager.accountSessions.set('a', fakeSession() as never)

    manager.closeSession('a')
    expect(() => manager.closeSession('a')).not.toThrow()
    expect(commentStore.reader.list('a')).toEqual([])
  })
})
