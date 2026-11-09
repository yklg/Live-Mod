import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// 与 STORAGE_KEYS.AI_CHAT_MESSAGES 同值；此处用字面量避免 Node 测试在模块加载时访问 localStorage。
const AI_CHAT_MESSAGES_STORAGE = 'ai-chat-messages-storage'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning_content?: string
  timestamp: number
  isError?: boolean
  streaming?: boolean
  stopped?: boolean
}

type Status = 'ready' | 'waiting' | 'replying' | 'streaming'

interface AIChatStore {
  messages: ChatMessage[]
  status: Status
  requestId: string | null
  lastUser: string
  autoScroll: boolean
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  appendToChat: (chunk: string) => void
  appendToReasoning: (chunk: string) => void
  tryToHandleEmptyMessage: (message: string) => void
  setMessages: (messages: ChatMessage[]) => void
  setStatus: (status: Status) => void
  setRequestId: (requestId: string | null) => void
  setLastUser: (text: string) => void
  finishStream: () => void
  stop: () => void
  retryText: () => string | null
  clearMessages: () => void
  setAutoScroll: (value: boolean) => void
}

const MAX_MESSAGES = 200

const memoryStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

function cap(messages: ChatMessage[]) {
  if (messages.length <= MAX_MESSAGES) return
  messages.splice(0, messages.length - MAX_MESSAGES)
}

export const useAIChatStore = create<AIChatStore>()(
  persist(
    immer<AIChatStore>((set, get) => {
      return {
        messages: [],
        status: 'ready' as Status,
        requestId: null,
        lastUser: '',
        autoScroll: true,
        addMessage: message => {
          set(state => {
            state.messages.push({
              ...message,
              id: crypto.randomUUID(),
              timestamp: Date.now(),
            })
            cap(state.messages)
          })
        },
        appendToChat: chunk => {
          set(state => {
            if (state.messages[state.messages.length - 1]?.role !== 'assistant') {
              state.messages.push({
                role: 'assistant',
                content: chunk,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                streaming: true,
              })
            } else {
              state.messages[state.messages.length - 1].content += chunk
            }
            cap(state.messages)
          })
        },
        appendToReasoning: chunk => {
          set(state => {
            if (state.messages[state.messages.length - 1]?.role !== 'assistant') {
              state.messages.push({
                role: 'assistant',
                reasoning_content: chunk,
                content: '',
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                streaming: true,
              })
            } else {
              state.messages[state.messages.length - 1].reasoning_content += chunk
            }
            cap(state.messages)
          })
        },
        tryToHandleEmptyMessage: message => {
          set(state => {
            const lastRole = state.messages[state.messages.length - 1]?.role
            if (!lastRole || lastRole === 'user') {
              state.messages.push({
                role: 'assistant',
                content: message,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                isError: true,
              })
            }
          })
        },
        setMessages: messages => {
          set(state => {
            state.messages = messages
          })
        },
        setStatus: status => {
          set(state => {
            state.status = status
          })
        },
        setRequestId: requestId => {
          set(state => {
            state.requestId = requestId
          })
        },
        setLastUser: text => {
          set(state => {
            state.lastUser = text
          })
        },
        finishStream: () => {
          set(state => {
            const last = state.messages[state.messages.length - 1]
            if (last?.role === 'assistant') last.streaming = false
          })
        },
        stop: () => {
          set(state => {
            state.status = 'ready'
            const last = state.messages[state.messages.length - 1]
            if (last?.role === 'assistant') {
              last.streaming = false
              last.stopped = true
            }
          })
        },
        retryText: (): string | null => {
          const messages = get().messages
          return [...messages].reverse().find(m => m.role === 'user')?.content ?? null
        },
        clearMessages: () => {
          set(state => {
            state.messages = []
            state.requestId = null
            state.lastUser = ''
            state.status = 'ready'
          })
        },
        setAutoScroll: (value: boolean) => {
          set(state => {
            state.autoScroll = value
          })
        },
      }
    }),
    {
      name: AI_CHAT_MESSAGES_STORAGE,
      version: 1,
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : memoryStorage,
      ),
      partialize: state => ({ messages: state.messages.slice(-MAX_MESSAGES) }),
    },
  ),
)
