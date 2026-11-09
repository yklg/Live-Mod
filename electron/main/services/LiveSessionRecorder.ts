// 场次记录器：组合层订阅会话域事件，AccountSession 不依赖任何 store。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { emitter } from '#/event/eventBus'
import { liveHistoryStore } from '#/services/LiveHistoryStore'
import windowManager from '#/windowManager'

let initialized = false

function broadcast() {
  windowManager.sendTo(
    'workspace',
    IPC_CHANNELS.workspace.historyUpdated,
    liveHistoryStore.snapshot(),
  )
}

export function initLiveSessionRecorder() {
  if (initialized) return
  initialized = true
  // 启动时把上次强退留下的 live 场次标为 interrupted
  liveHistoryStore.markInterrupted()
  emitter.on('live-session-started', ({ accountId, platform, startedAt }) => {
    liveHistoryStore.recordStart(accountId, platform, startedAt)
    broadcast()
  })
  emitter.on('live-session-ended', ({ accountId, endedAt }) => {
    liveHistoryStore.recordEnd(accountId, endedAt)
    broadcast()
  })
}
