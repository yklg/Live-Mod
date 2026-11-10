import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== IPC 来源授权矩阵（W2 · TC-TR1~TR7）=====
// 守护不变量：
//   C-TR1 声明表存在（漏建则后续全部失效）
//   C-TR2 rail（壳完整业务树）放行 —— dev 与打包 URL 都要认，这是 P0-1 的回归点；
//         经典模式入口随经典模式移除而拒绝（来源 unknown）
//   C-TR3 chrome / legacy / notice 拒绝（缩小暴露面）
//   C-TR4 未注册判定器 = fail-closed（拒绝，而不是默认放行）
//   C-TR5 sender.getURL 异常仍归约为拒绝，不产生未处理异常逃逸
//   C-TR6 未声明通道不校验（52 处注册里 50 处零回归）
//   C-TR7 判定器可覆盖（先 URL 版、后 id 精确版）

const h = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  return { handlers }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, listener)
    },
    on: () => {},
  },
}))

import { IPC_CHANNELS } from 'shared/ipcChannels'
import { CHANNEL_TRUST, classifyViewUrl, setTrustResolver, typedIpcMainHandle } from '#/utils/ipc'

const RESTRICTED = IPC_CHANNELS.tasks.commentBackend.getState
const FREE = IPC_CHANNELS.tasks.autoMessage.stop

const sender = (url: string) => ({
  sender: { id: 1, getURL: () => url },
})

const call = (channel: string, url: string) => {
  const handler = h.handlers.get(channel)
  if (!handler) throw new Error(`未注册 handler: ${channel}`)
  return handler(sender(url))
}

const DEV_RAIL = 'http://localhost:5173/rail.html?view=rail'
const PROD_RAIL = 'file:///Applications/Live%20Mod/dist/rail.html?view=rail'
const DEV_CLASSIC = 'http://localhost:5173/'
const PROD_CLASSIC = 'file:///Applications/Live%20Mod/dist/index.html'

describe('IPC 授权矩阵（TC-TR1~TR7）', () => {
  beforeEach(() => {
    h.handlers.clear()
    setTrustResolver(event =>
      classifyViewUrl((event as { sender: { getURL(): string } }).sender.getURL()),
    )
  })

  it('TC-TR1 受限通道已登记在 CHANNEL_TRUST（未登记 = 校验不会执行）', () => {
    expect(CHANNEL_TRUST[RESTRICTED]).toBe('business-ui')
    expect(CHANNEL_TRUST[IPC_CHANNELS.tasks.commentBackend.send]).toBe('business-ui')
  })

  it('TC-TR2 rail 放行（dev/prod 两种 URL 都认）', () => {
    const listener = vi.fn(() => ({ accounts: [], debug: false }))
    typedIpcMainHandle(RESTRICTED, listener)

    for (const url of [DEV_RAIL, PROD_RAIL]) {
      expect(() => call(RESTRICTED, url)).not.toThrow()
    }
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('TC-TR2b 经典模式入口不再放行（经典模式已移除，来源归约为 unknown）', () => {
    typedIpcMainHandle(RESTRICTED, () => ({ accounts: [], debug: false }))

    for (const url of [DEV_CLASSIC, PROD_CLASSIC]) {
      expect(() => call(RESTRICTED, url)).toThrow(/实际来源 unknown/)
    }
  })

  it('TC-TR3 chrome / entry / notice 一律拒绝', () => {
    typedIpcMainHandle(RESTRICTED, () => ({ accounts: [], debug: false }))
    const urls = [
      'http://localhost:5173/chrome.html?view=chrome',
      'http://localhost:5173/entry.html?view=entry',
      'file:///app/dist/notice.html?view=notice',
    ]
    for (const url of urls) {
      expect(() => call(RESTRICTED, url)).toThrow(/仅允许 business-ui/)
    }
  })

  it('TC-TR4 未注册判定器 → fail-closed（拒绝而非放行）', () => {
    typedIpcMainHandle(RESTRICTED, () => ({ accounts: [], debug: false }))
    setTrustResolver(null)

    expect(() => call(RESTRICTED, DEV_RAIL)).toThrow(/实际来源 unknown/)
  })

  it('TC-TR5 sender.getURL 抛异常 → 仍归约为拒绝', () => {
    typedIpcMainHandle(RESTRICTED, () => ({ accounts: [], debug: false }))
    setTrustResolver(() => {
      throw new Error('webContents destroyed')
    })

    expect(() => call(RESTRICTED, DEV_RAIL)).toThrow()
  })

  it('TC-TR6 未声明通道不校验（零回归：判定器为 unknown 也照旧放行）', () => {
    const listener = vi.fn(() => undefined)
    typedIpcMainHandle(FREE, listener as never)
    setTrustResolver(() => 'unknown')

    expect(() => call(FREE, 'https://evil.example.com/')).not.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('TC-TR7 判定器可覆盖：后注册者生效（URL 版 → id 精确版）', () => {
    typedIpcMainHandle(RESTRICTED, () => ({ accounts: [], debug: false }))
    // 同一个 URL，但覆盖判定器后把它是 rail 这一结论改判为 chrome
    setTrustResolver(() => 'chrome')

    expect(() => call(RESTRICTED, DEV_RAIL)).toThrow(/实际来源 chrome/)
  })

  it('TC-TR8 ai-ui：rail/assistant 放行；chrome/entry/notice 拒绝', () => {
    typedIpcMainHandle(IPC_CHANNELS.tasks.aiChat.chat, (() => {}) as never)
    for (const url of [
      DEV_RAIL,
      'file:///Applications/Live%20Mod/dist/assistant.html?view=assistant',
    ]) {
      expect(() => call(IPC_CHANNELS.tasks.aiChat.chat, url)).not.toThrow()
    }
    for (const url of [
      'http://localhost:5173/chrome.html?view=chrome',
      'http://localhost:5173/entry.html?view=entry',
      'file:///app/dist/notice.html?view=notice',
    ]) {
      expect(() => call(IPC_CHANNELS.tasks.aiChat.chat, url)).toThrow(/仅允许 ai-ui/)
    }
  })

  it('TC-TR9 shell-ui：chrome/rail/assistant 放行；entry/notice 拒绝', () => {
    typedIpcMainHandle(IPC_CHANNELS.shell.assistantToggle, (() => {}) as never)
    for (const url of [
      'http://localhost:5173/chrome.html?view=chrome',
      DEV_RAIL,
      'file:///Applications/Live%20Mod/dist/assistant.html?view=assistant',
    ]) {
      expect(() => call(IPC_CHANNELS.shell.assistantToggle, url)).not.toThrow()
    }
    for (const url of [
      'http://localhost:5173/entry.html?view=entry',
      'file:///app/dist/notice.html?view=notice',
    ]) {
      expect(() => call(IPC_CHANNELS.shell.assistantToggle, url)).toThrow(/仅允许 shell-ui/)
    }
  })

  it('TC-TR10 entry-ui：只放行入口选择器；chrome/rail/assistant 拒绝', () => {
    typedIpcMainHandle(IPC_CHANNELS.shell.entryCatalog, (() => ({
      platforms: [],
      remembered: {},
    })) as never)
    const entryUrl = 'http://localhost:5173/entry.html?view=entry'
    expect(() => call(IPC_CHANNELS.shell.entryCatalog, entryUrl)).not.toThrow()
    for (const url of [
      DEV_RAIL,
      'http://localhost:5173/chrome.html?view=chrome',
      'file:///app/dist/assistant.html',
    ]) {
      expect(() => call(IPC_CHANNELS.shell.entryCatalog, url)).toThrow(/仅允许 entry-ui/)
    }
  })

  it('TC-TR11 entry-reopen：entry/rail 放行；chrome/assistant 拒绝', () => {
    typedIpcMainHandle(IPC_CHANNELS.shell.entryReopen, (() => undefined) as never)
    for (const url of [DEV_RAIL, 'http://localhost:5173/entry.html?view=entry']) {
      expect(() => call(IPC_CHANNELS.shell.entryReopen, url)).not.toThrow()
    }
    for (const url of [
      'http://localhost:5173/chrome.html?view=chrome',
      'file:///app/dist/assistant.html',
    ]) {
      expect(() => call(IPC_CHANNELS.shell.entryReopen, url)).toThrow(/仅允许 entry-reopen/)
    }
  })
})

describe('classifyViewUrl（P0-1 判据回归）', () => {
  it('dev 与 prod 的 rail 都要识别，不能依赖 /dist/ 路径', () => {
    expect(classifyViewUrl(DEV_RAIL)).toBe('rail')
    expect(classifyViewUrl(PROD_RAIL)).toBe('rail')
    expect(classifyViewUrl('http://localhost:5173/rail.html')).toBe('rail')
    expect(classifyViewUrl('https://buyin.jinritemai.com/dashboard')).toBe('unknown')
    expect(classifyViewUrl('')).toBe('unknown')
  })

  it('经典模式入口（index/根路径）不再识别为受信视图', () => {
    expect(classifyViewUrl(PROD_CLASSIC)).toBe('unknown')
    expect(classifyViewUrl(DEV_CLASSIC)).toBe('unknown')
    expect(classifyViewUrl('http://localhost:5173/')).toBe('unknown')
  })

  it('assistant / drag / entry 本地视图身份可识别（不是 remote page）', () => {
    expect(classifyViewUrl('file:///x/assistant.html')).toBe('assistant')
    expect(classifyViewUrl('http://127.0.0.1:7777/drag.html')).toBe('drag')
    expect(classifyViewUrl('http://localhost:5173/entry.html?view=entry')).toBe('entry')
    expect(classifyViewUrl('file:///Applications/Live%20Mod/dist/entry.html?view=entry')).toBe(
      'entry',
    )
  })
})
