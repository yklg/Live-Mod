// workspace 数据 IPC（第二期）：场次历史只读快照。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { liveHistoryStore } from '#/services/LiveHistoryStore'
import { typedIpcMainHandle } from '#/utils'

function setupHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.workspace.history, () => liveHistoryStore.snapshot())
}

export function setupWorkspaceIpcHandlers() {
  setupHandlers()
}
