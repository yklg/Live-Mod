import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RotateCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { APIKeyDialog } from '@/components/ai-chat/APIKeyDialog'
import { MessageContent } from '@/components/ai-chat/MessageContent'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type ChatMessage, useAIChatStore } from '@/hooks/useAIChat'
import { useAIProvider } from '@/hooks/useAIProvider'
import { useProviders } from '@/hooks/useProviders'
import { initTheme } from '@/hooks/useTheme'
import { messagesToContext } from '@/lib/utils'
import '../index.css'

initTheme()
document.body.style.background = 'transparent'

const PROMPTS = [
  '帮我写 3 条不重复的欢迎话术',
  '把 3 号链接卖点压缩成 3 句',
  '总结最近 10 条观众提问',
]

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function useAssistantController() {
  const {
    messages,
    status,
    requestId,
    autoScroll,
    setAutoScroll,
    addMessage,
    appendToChat,
    appendToReasoning,
    tryToHandleEmptyMessage,
    setStatus,
    setRequestId,
    setLastUser,
    finishStream,
    stop,
    retryText,
  } = useAIChatStore()
  const { config, apiKeys, customBaseURL, hydrated } = useAIProvider('chat')

  useEffect(() => {
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.assistantReady)
  }, [])

  useEffect(() => {
    const removeStream = window.ipcRenderer.on(IPC_CHANNELS.tasks.aiChat.stream, result => {
      const current = useAIChatStore.getState().requestId
      if ('requestId' in result && result.requestId && current && result.requestId !== current)
        return
      if ('done' in result && result.done) {
        setStatus('ready')
        finishStream()
        tryToHandleEmptyMessage('可能是网络请求超时，也可能是接收到了空数据')
        setRequestId(null)
        return
      }
      if ('chunk' in result && result.chunk) {
        setStatus('streaming')
        if (result.type === 'reasoning') appendToReasoning(result.chunk)
        else appendToChat(result.chunk)
      }
    })
    const removeError = window.ipcRenderer.on(
      IPC_CHANNELS.tasks.aiChat.error,
      ({ error, requestId: id }) => {
        const current = useAIChatStore.getState().requestId
        if (id && current && id !== current) return
        addMessage({ role: 'assistant', content: `请求失败：${error}`, isError: true })
        setStatus('ready')
        setRequestId(null)
      },
    )
    return () => {
      removeStream()
      removeError()
    }
  }, [
    addMessage,
    appendToChat,
    appendToReasoning,
    finishStream,
    setRequestId,
    setStatus,
    tryToHandleEmptyMessage,
  ])

  const send = (text: string) => {
    const value = text.trim()
    if (!value || status === 'streaming' || status === 'waiting' || status === 'replying') return
    if (!hydrated) {
      addMessage({ role: 'assistant', content: '配置还在加载中，请稍后再试。', isError: true })
      return
    }
    const apiKey = apiKeys[config.provider]
    if (!apiKey) {
      addMessage({
        role: 'assistant',
        content: '还没有配置 API Key。点右上角「更多」→「配置 API Key」即可。',
        isError: true,
      })
      return
    }
    const id = crypto.randomUUID()
    const context = messagesToContext(useAIChatStore.getState().messages, value)
    addMessage({ role: 'user', content: value })
    setLastUser(value)
    setRequestId(id)
    setStatus('streaming')
    setAutoScroll(true)
    void window.ipcRenderer
      .invoke(IPC_CHANNELS.tasks.aiChat.chat, {
        messages: context,
        apiKey,
        provider: config.provider,
        model: config.model,
        customBaseURL,
        requestId: id,
      })
      .catch((error: unknown) => {
        addMessage({
          role: 'assistant',
          content: `请求失败：${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        })
        setStatus('ready')
        setRequestId(null)
      })
  }

  const abort = () => {
    if (requestId) void window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.abort, requestId)
    stop()
  }

  const retry = () => {
    const text = retryText()
    if (text) send(text)
  }

  return {
    messages,
    status,
    autoScroll,
    setAutoScroll,
    send,
    abort,
    retry,
    hydrated,
  }
}

function Avatar({ role }: { role: 'user' | 'assistant' | 'system' }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
        role === 'user' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
      }`}
    >
      {role === 'user' ? '你' : <Sparkles className="size-3.5" />}
    </span>
  )
}

function MessageRow({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar role={message.role} />
      <div className={`min-w-0 max-w-[86%] ${isUser ? 'items-end' : ''}`}>
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{isUser ? '你' : 'AI 助手'}</span>
          <span>{formatTime(message.timestamp)}</span>
        </div>
        {!isUser && message.reasoning_content ? (
          <details className="mb-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              思考过程 · {message.streaming ? '进行中' : '已完成'}
            </summary>
            <div className="mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-muted-foreground">
              {message.reasoning_content}
            </div>
          </details>
        ) : null}
        {message.isError ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5" /> 请求失败
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-[11px] hover:bg-destructive/10"
              onClick={onRetry}
            >
              <RotateCw className="size-3" /> 重试
            </button>
          </div>
        ) : (
          <div
            className={`rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
              isUser
                ? 'rounded-tr-sm bg-muted text-foreground'
                : 'rounded-tl-sm border border-border bg-card'
            }`}
          >
            {message.content ? (
              isUser ? (
                <div className="whitespace-pre-wrap">{message.content}</div>
              ) : (
                <MessageContent content={message.content} />
              )
            ) : message.streaming ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> 正在思考…
              </span>
            ) : null}
            {message.streaming ? (
              <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-primary align-middle" />
            ) : null}
          </div>
        )}
        {!isUser && !message.isError && message.content ? (
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => void navigator.clipboard?.writeText(message.content)}
            >
              <Copy className="size-3" /> 复制
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={onRetry}
            >
              <RotateCw className="size-3" /> 重试
            </button>
            {message.stopped ? <span>已停止</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Composer({
  status,
  onSend,
  onAbort,
  providers,
  provider,
  model,
}: {
  status: string
  onSend: (text: string) => void
  onAbort: () => void
  providers: Record<string, ProviderInfo>
  provider: string
  model: string
}) {
  const [input, setInput] = useState('')
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streaming = status === 'streaming' || status === 'waiting' || status === 'replying'

  const grow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(112, Math.max(22, el.scrollHeight))}px`
  }

  const submit = () => {
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = '22px'
    onSend(text)
  }

  return (
    <div className="shrink-0 border-t border-border bg-background/80 p-2.5">
      <div className="rounded-xl border border-border bg-card p-2 shadow-elevation-1 focus-within:border-primary">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={e => {
            setInput(e.target.value)
            grow()
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={e => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !composingRef.current &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="给 AI 发消息，或输入 @ 商品 / 话术…"
          className="max-h-28 min-h-[22px] w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          data-testid="assistant-input"
        />
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Sparkles className="size-2.5" />
            {providers[provider]?.name ?? provider} · {model}
          </span>
          <span className="flex-1" />
          <span className="hidden text-[9.5px] text-muted-foreground sm:inline">
            Enter 发送 · Shift+Enter 换行
          </span>
          <button
            type="button"
            className={`grid size-7 shrink-0 place-items-center rounded-lg ${
              streaming
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40'
            }`}
            onClick={streaming ? onAbort : submit}
            disabled={!streaming && !input.trim()}
            aria-label={streaming ? '停止生成' : '发送'}
          >
            {streaming ? <Square className="size-3" /> : <Send className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function AssistantApp() {
  const { messages, status, send, abort, retry, hydrated } = useAssistantController()
  const { config } = useAIProvider('chat')
  const providers = useProviders()
  const { clearMessages } = useAIChatStore()
  const [moreOpen, setMoreOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖用于在消息/状态变化时触发滚动，effect 内部读的是 store 快照
  useEffect(() => {
    if (useAIChatStore.getState().autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, status])

  const prompts = useMemo(() => PROMPTS, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-float border-hairline border-border bg-background text-foreground shadow-float">
      <header
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold" data-testid="assistant-title">
          AI 助手
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[9px] text-success">
          <Check className="size-2.5" /> 已连接
        </span>
        <span className="flex-1" />
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="更多"
                title="更多"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="px-1 pb-2 text-[10px] text-muted-foreground">当前模型</div>
              <div className="mb-2 flex items-center justify-between rounded-md bg-muted px-2 py-1.5 text-[11px]">
                <span className="truncate">
                  {providers[config.provider]?.name ?? config.provider}
                </span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {config.model}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <APIKeyDialog type="chat" />
                <button
                  type="button"
                  className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    clearMessages()
                    setMoreOpen(false)
                  }}
                >
                  <Trash2 className="size-3.5" /> 清空对话
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="关闭"
            title="关闭（对话保留）"
            onClick={() => void window.ipcRenderer.invoke(IPC_CHANNELS.shell.assistantClose)}
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div className="text-sm font-semibold">今天想先处理什么？</div>
            <p className="max-w-[280px] text-[11px] leading-relaxed text-muted-foreground">
              我知道这场直播的商品、话术和互动状态。可以直接问，也可以从下面开始。
            </p>
            <div className="mt-1 flex w-full max-w-[340px] flex-col gap-1.5">
              {prompts.map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-[11px] text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                  onClick={() => {
                    const el = document.querySelector<HTMLTextAreaElement>('textarea')
                    if (el) {
                      const setter = Object.getOwnPropertyDescriptor(
                        HTMLTextAreaElement.prototype,
                        'value',
                      )?.set
                      setter?.call(el, prompt)
                      el.dispatchEvent(new Event('input', { bubbles: true }))
                      el.focus()
                    }
                  }}
                >
                  <MessageSquare className="size-3.5 shrink-0" /> {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map(message => (
              <MessageRow key={message.id} message={message} onRetry={retry} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <Composer
        status={status}
        onSend={send}
        onAbort={abort}
        providers={providers}
        provider={config.provider}
        model={config.model}
      />
      {!hydrated ? (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
          配置加载中…
        </div>
      ) : null}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <AssistantApp />
  </React.StrictMode>,
)
