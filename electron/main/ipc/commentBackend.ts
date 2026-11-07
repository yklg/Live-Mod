// B2 评论后端 IPC：壳 rail 查询后端状态（事件推送走 windowManager.send → ui 目标）
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { commentBackendRegistry } from '#/services/commentBackend/registry'
import { typedIpcMainHandle } from '#/utils'

/** sender 校验：仅允许壳 rail 页面调用（安全 P1-7） */
function assertRailSender(event: IpcMainInvokeEvent): void {
  const url = event.sender.getURL()
  if (!url.includes('/dist/rail.html')) {
    throw new Error('commentBackend: 仅允许壳 rail 调用')
  }
}

export function setupCommentBackendIpcHandlers(): void {
  typedIpcMainHandle(IPC_CHANNELS.tasks.commentBackend.getState, event => {
    assertRailSender(event)
    return { accounts: commentBackendRegistry.list() }
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.commentBackend.send, (event, accountId, content) => {
    assertRailSender(event)
    const backend = commentBackendRegistry.get(accountId)
    if (!backend?.sendReply) return { ok: false, error: '评论后端未连接' }
    return backend.sendReply(content)
  })
}
