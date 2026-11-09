import { beforeEach, describe, expect, it } from 'vitest'
import { useAIChatStore } from '@/hooks/useAIChat'

const store = () => useAIChatStore.getState()

beforeEach(() => {
  store().clearMessages()
  store().setStatus('ready')
  store().setAutoScroll(true)
})

describe('useAIChat store', () => {
  it('TC-AC1 add/append/reasoning 保持消息顺序与流式标记', () => {
    store().addMessage({ role: 'user', content: 'hello' })
    store().appendToReasoning('thinking')
    store().appendToChat('answer')
    const messages = store().messages
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1].reasoning_content).toBe('thinking')
    expect(messages[1].content).toBe('answer')
    expect(messages[1].streaming).toBe(true)
  })

  it('TC-AC2 finishStream 关闭流式标记；stop 标记 stopped', () => {
    store().addMessage({ role: 'user', content: 'q' })
    store().appendToChat('a')
    store().finishStream()
    expect(store().messages.at(-1)?.streaming).toBe(false)
    store().stop()
    expect(store().status).toBe('ready')
    expect(store().messages.at(-1)?.stopped).toBe(true)
  })

  it('TC-AC3 retryText 返回最近一条用户消息；clear 清空', () => {
    store().addMessage({ role: 'user', content: 'first' })
    store().addMessage({ role: 'assistant', content: 'ok' })
    store().addMessage({ role: 'user', content: 'second' })
    expect(store().retryText()).toBe('second')
    store().clearMessages()
    expect(store().messages).toEqual([])
    expect(store().retryText()).toBeNull()
  })

  it('TC-AC4 消息上限 200（超出淘汰最旧）', () => {
    for (let i = 0; i < 205; i++) store().addMessage({ role: 'user', content: `m${i}` })
    expect(store().messages.length).toBe(200)
    expect(store().messages[0].content).toBe('m5')
    expect(store().messages.at(-1)?.content).toBe('m204')
  })

  it('TC-AC5 空响应只补一条错误，不重复追加', () => {
    store().addMessage({ role: 'user', content: 'q' })
    store().tryToHandleEmptyMessage('empty')
    store().tryToHandleEmptyMessage('empty')
    expect(store().messages.filter(m => m.isError)).toHaveLength(1)
  })
})
