import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AIChatService } from '#/services/AIChatServices'
import { typedIpcMainHandle } from '#/utils'
import windowManager from '#/windowManager'

// 同一时刻只让一个 requestId 持有流；abort 只取消对应请求，不影响 AutoReply 的 normalChat。
const active = new Map<string, AbortController>()

type StreamPayload =
  | { chunk: string; type: 'content' | 'reasoning'; requestId: string }
  | { done: boolean; aborted?: boolean; requestId: string }

function sendStream(data: StreamPayload) {
  windowManager.sendTo('assistant', IPC_CHANNELS.tasks.aiChat.stream, data)
}

function sendError(error: string, requestId: string) {
  windowManager.sendTo('assistant', IPC_CHANNELS.tasks.aiChat.error, { error, requestId })
}

function setupIpcHandlers() {
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.aiChat.chat,
    async (_, { messages, apiKey, provider, model, customBaseURL, requestId }) => {
      const id = requestId || randomUUID()
      const controller = new AbortController()
      active.set(id, controller)
      try {
        const aiService = AIChatService.createService(apiKey, provider, customBaseURL)
        for await (const { content, reasoning } of aiService.chatStream(
          messages,
          model,
          controller.signal,
        )) {
          if (content) sendStream({ chunk: content, type: 'content', requestId: id })
          if (reasoning) sendStream({ chunk: reasoning, type: 'reasoning', requestId: id })
        }
        sendStream({ done: true, requestId: id })
      } catch (error) {
        if (controller.signal.aborted) {
          sendStream({ done: true, aborted: true, requestId: id })
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error)
          sendError(errorMessage, id)
        }
      } finally {
        active.delete(id)
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.aiChat.abort, (_, requestId) => {
    active.get(requestId)?.abort()
    active.delete(requestId)
  })

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.aiChat.normalChat,
    async (_, { messages, apiKey, provider, model, customBaseURL }) => {
      try {
        const aiService = AIChatService.createService(apiKey, provider, customBaseURL)
        const output = await aiService.chat(messages, model)
        return output
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        windowManager.send(IPC_CHANNELS.tasks.aiChat.error, { error: errorMessage })
      }
      return null
    },
  )

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.aiChat.testApiKey,
    async (_, { apiKey, provider, customBaseURL }) => {
      try {
        const aiService = AIChatService.createService(apiKey, provider, customBaseURL)
        await aiService.checkAPIKey()
        return {
          success: true,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          success: false,
          error: errorMessage,
        }
      }
    },
  )
}

export function setupAIChatIpcHandlers() {
  setupIpcHandlers()
}
