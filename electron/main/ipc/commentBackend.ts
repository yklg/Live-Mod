// B2 评论后端 IPC：壳 rail / 经典主窗口查询后端状态与历史（事件推送走 windowManager.send → 'ui'）
//
// W2 变更：
//   1. 来源授权交给 utils/ipc 的 CHANNEL_TRUST 声明表（删掉手写 `assertRailSender`——
//      它的 `/dist/rail.html` 判据在 dev 下恒假，直接误杀）。
//   2. `getState` 返回 store 快照里的历史评论（此前只有 status，面板重挂载即清空）。
//   3. `send` 增加**账号归属校验**：授权解决"谁能调"，归属解决"能操作谁的数据"。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { accountManager } from '#/managers/AccountManager'
import { commentBackendRegistry } from '#/services/commentBackend/registry'
import { commentStore } from '#/services/commentBackend/store'
import { typedIpcMainHandle } from '#/utils'
import windowManager from '#/windowManager'

/** 对外历史条数（存储上限是每账号 200/全局 500，这里只暴露最近 100） */
const HISTORY_LIMIT = 100

/** 调试注入是否启用（无真实直播时验收面板用；生产不注册通道） */
const DEBUG_INJECT = process.env.LM_SHELL_DEBUG === '1'
/** 未连接任何账号时，调试注入使用的占位账号（仅 debug 模式下出现在 getState 里） */
const DEBUG_ACCOUNT = '__debug__'

function firstAccountId(): string {
  return (
    [...accountManager.accountSessions.keys()][0] ??
    commentBackendRegistry.list()[0]?.accountId ??
    DEBUG_ACCOUNT
  )
}

export function setupCommentBackendIpcHandlers(): void {
  typedIpcMainHandle(IPC_CHANNELS.tasks.commentBackend.getState, () => {
    const snap = commentStore.reader.snapshot(HISTORY_LIMIT)
    const snapById = new Map(snap.accounts.map(a => [a.accountId, a]))
    const statusById = new Map(commentBackendRegistry.list().map(e => [e.accountId, e.status]))

    // 顺序：当前登记的后端在前，仅有历史的在后（后端停了但会话仍在时可回看）
    const ids: string[] = [...statusById.keys()]
    for (const id of snapById.keys()) if (!statusById.has(id)) ids.push(id)

    return {
      accounts: ids
        // 归属校验：只暴露仍登记在案会话的数据，未知 accountId 一律不出现。
        // 例外：debug 模式的占位账号 —— 否则未连接时无法验收面板本身。
        .filter(
          accountId =>
            accountManager.accountSessions.has(accountId) ||
            (DEBUG_INJECT && accountId === DEBUG_ACCOUNT),
        )
        .map(accountId => ({
          accountId,
          status: statusById.get(accountId) ?? snapById.get(accountId)!.status,
          comments: snapById.get(accountId)?.comments ?? [],
        })),
      debug: DEBUG_INJECT,
    }
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.commentBackend.send, (_event, accountId, content) => {
    if (!accountManager.accountSessions.has(accountId)) {
      return { ok: false, error: '账号不存在或已断开' }
    }
    const backend = commentBackendRegistry.get(accountId)
    if (!backend?.sendReply) return { ok: false, error: '评论后端未连接' }
    return backend.sendReply(content)
  })

  // 调试注入：仅 debug 模式注册。走与真实链路完全相同的两段式（先落 store 再推送），
  // 这样才能验证「实时显示」与「切走再回来从快照回放」两件事。
  if (DEBUG_INJECT) {
    typedIpcMainHandle(IPC_CHANNELS.tasks.commentBackend.debugInject, (_event, text) => {
      const accountId = firstAccountId()
      if (!accountId) {
        return { ok: false, error: '没有可用账号：请先在壳内连接一个直播账号' }
      }
      const now = Date.now()
      const content = (text || '').trim() || '测试评论（调试注入）'
      const comment = {
        id: `dbg-${now}-${Math.random().toString(36).slice(2, 8)}`,
        nickName: '调试观众',
        content,
        at: now,
        accountId,
      }
      commentStore.writer.append(accountId, [comment])
      windowManager.send(IPC_CHANNELS.tasks.commentBackend.comment, { accountId, comment })
      return { ok: true, accountId }
    })
  }
}
