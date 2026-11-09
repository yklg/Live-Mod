// AI 配置 IPC：主进程 AIProviderStore 是唯一真源；渲染层 get/set/migrate，变更广播给 rail/assistant。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  applyAIProviderPatch,
  importLegacyAIProviderState,
  loadAIProviderState,
  saveAIProviderState,
} from '#/services/AIProviderStore'
import { typedIpcMainHandle } from '#/utils'
import windowManager from '#/windowManager'

function broadcast(state: ReturnType<typeof loadAIProviderState>) {
  const payload = { chat: state.chat, autoReply: state.autoReply }
  windowManager.sendTo('ui', IPC_CHANNELS.aiProvider.state, payload)
  if (windowManager.hasTarget('assistant')) {
    windowManager.sendTo('assistant', IPC_CHANNELS.aiProvider.state, payload)
  }
}

export function setupAIProviderIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.aiProvider.get, () => {
    const stored = loadAIProviderState()
    return { state: { chat: stored.chat, autoReply: stored.autoReply }, migrated: stored.migrated }
  })

  typedIpcMainHandle(IPC_CHANNELS.aiProvider.set, (_, payload) => {
    const stored = loadAIProviderState()
    const next = applyAIProviderPatch(stored, payload.type, payload.patch)
    const saved = saveAIProviderState({
      version: stored.version,
      migrated: stored.migrated,
      ...next,
    })
    if (saved) broadcast({ ...stored, ...next })
  })

  typedIpcMainHandle(IPC_CHANNELS.aiProvider.migrate, (_, legacy) => {
    const current = loadAIProviderState()
    if (current.migrated) return { chat: current.chat, autoReply: current.autoReply }
    const migrated = importLegacyAIProviderState(legacy)
    const saved = saveAIProviderState({
      version: current.version,
      migrated: true,
      ...migrated,
    })
    if (saved) broadcast({ ...current, migrated: true, ...migrated })
    return migrated
  })
}
