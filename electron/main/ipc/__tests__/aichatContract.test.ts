import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

describe('AI chat main contract', () => {
  it('流式事件定向 assistant，带 requestId，并支持 abort', () => {
    const src = read('electron/main/ipc/aichat.ts')
    expect(src).toContain("sendTo('assistant'")
    expect(src).toContain('requestId')
    expect(src).toContain('AbortController')
    expect(src).toContain('IPC_CHANNELS.tasks.aiChat.abort')
  })

  it('AIProvider 变更广播 rail 与 assistant；消息键与配置键分离', () => {
    const ipc = read('electron/main/ipc/aiProvider.ts')
    expect(ipc).toContain("sendTo('ui'")
    expect(ipc).toContain("sendTo('assistant'")
    const chat = read('src/hooks/useAIChat.ts')
    expect(chat).toContain("'ai-chat-messages-storage'")
    expect(chat).not.toContain("'ai-chat-storage'")
  })
})
