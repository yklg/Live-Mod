import type { BrowserWindow, WebContents } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { describe, expect, it } from 'vitest'
import { type PushTarget, WindowManager } from '#/windowManager'

// ===== 传输层契约（W3 · TC-WQ1~WQ10）=====
// 守护不变量：
//   C-WQ1  已注册具名目标时，投递走具名目标且返回 true（不误入队列）
//   C-WQ2  `ui` 目标缺失时**绝不回退主窗口**（壳模式主窗口是空容器，回退=静默黑洞）
//   C-WQ3  白名单通道按 FIFO 入队，注册目标后按序 flush
//   C-WQ4  非白名单通道直接丢弃，stderr 恰 1 条（限频）
//   C-WQ5  超过 TTL 的待发事件在 flush 时丢弃并报一次
//   C-WQ6  队列溢出丢最旧，容量 32，报一次
//   C-WQ7  连续 100 次投递失败只产生 1 条 stderr（且不走 logger ⇒ 不递归）
//   C-WQ8  目标销毁后摘除引用，后续走队列分支而非命中死对象
//   C-WQ9  正常投递不得写 stderr（否则日志噪音淹没真问题）
//   C-WQ10 经典模式：显式 setUITarget(mainWindow.webContents) 后 send 命中主窗口
// 说明：本模块只 `import type` electron，故可在 node 环境直接实例化 —— 这是可测化的前提。

interface FakeWc {
  label: string
  destroyed: boolean
  throwOnSend: boolean
  sent: Array<{ channel: string; args: unknown[] }>
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

/**
 * 本文件只测传输行为（队列/回退/限频），不关心各通道的 payload 形状 ——
 * 那由各自的 IPC 层测试负责。这里统一放宽参数类型，避免把传输测试写成 payload 样例集。
 */
const send = (wm: WindowManager, channel: string, ...args: unknown[]): boolean =>
  (wm.send as unknown as (c: string, ...a: unknown[]) => boolean)(channel, ...args)

const sendTo = (
  wm: WindowManager,
  target: PushTarget,
  channel: string,
  ...args: unknown[]
): boolean =>
  (wm.sendTo as unknown as (t: string, c: string, ...a: unknown[]) => boolean)(
    target,
    channel,
    ...args,
  )

function makeWc(label: string): FakeWc {
  return {
    label,
    destroyed: false,
    throwOnSend: false,
    sent: [],
    isDestroyed() {
      return this.destroyed
    },
    send(channel: string, ...args: unknown[]) {
      if (this.throwOnSend) throw new Error('send failed')
      this.sent.push({ channel, args })
    },
  }
}

function makeWin(wc: FakeWc) {
  const win = {
    destroyed: false,
    webContents: wc,
    isDestroyed() {
      return win.destroyed
    },
    on: () => {},
  }
  return win
}

const asWc = (wc: FakeWc) => wc as unknown as WebContents
const asWin = (win: ReturnType<typeof makeWin>) => win as unknown as BrowserWindow

/** 注入时钟 + stderr 收集器（不读控制台文本） */
function makeManager() {
  const lines: string[] = []
  const clock = { t: 0 }
  const wm = new WindowManager({
    now: () => clock.t,
    writeStderr: (line: string) => void lines.push(line),
  })
  const failures = () => lines.filter(l => l.includes('推送失败'))
  return { wm, lines, clock, failures }
}

const SAVE_STATE = IPC_CHANNELS.chrome.saveState
const PROVIDERS_UPDATED = IPC_CHANNELS.app.providersUpdated
const UPDATER_PROGRESS = IPC_CHANNELS.updater.downloadProgress
const NON_QUEUED = IPC_CHANNELS.tasks.aiChat.stream

describe('windowManager 传输契约（TC-WQ1 / TC-WQ10）', () => {
  it('TC-WQ1 [已注册目标] 投递走具名目标、返回 true、不重复投递给主窗口', () => {
    const { wm } = makeManager()
    const uiWc = makeWc('ui')
    const mainWc = makeWc('main')

    wm.setMainWindow(asWin(makeWin(mainWc)))
    wm.setUITarget(asWc(uiWc))

    const ok = send(wm, IPC_CHANNELS.log, { level: 'info', message: 'hello' })

    expect(ok).toBe(true)
    expect(uiWc.sent).toHaveLength(1)
    expect(uiWc.sent[0].channel).toBe(IPC_CHANNELS.log)
    // 关键：具名目标命中时绝不旁路到主窗口（否则同一事件双投）
    expect(mainWc.sent).toHaveLength(0)
  })

  it('TC-WQ10 [经典模式] 显式 setUITarget(mainWindow.webContents) 后 send 命中主窗口', () => {
    const { wm } = makeManager()
    const mainWc = makeWc('main')
    const win = makeWin(mainWc)

    wm.setMainWindow(asWin(win))
    // 经典模式必须显式登记（v2 §5.5：不再依赖隐式回退）
    wm.setUITarget(win.webContents as unknown as WebContents)

    const ok = send(wm, IPC_CHANNELS.log, { level: 'info', message: 'classic' })

    expect(ok).toBe(true)
    expect(mainWc.sent).toHaveLength(1)
    expect(mainWc.sent[0].channel).toBe(IPC_CHANNELS.log)
  })
})

describe('windowManager 删隐式回退（TC-WQ2 / WQ8）', () => {
  it('TC-WQ2 [无回退] ui 目标缺失但主窗口存活时，绝不投递给主窗口', () => {
    const { wm } = makeManager()
    const mainWc = makeWc('main')
    wm.setMainWindow(asWin(makeWin(mainWc)))

    const ok = send(wm, IPC_CHANNELS.log, { level: 'info', message: 'lost' })

    expect(ok).toBe(false)
    expect(mainWc.sent).toHaveLength(0) // P0-3 的核心断言
  })

  it('TC-WQ8 目标销毁后摘除引用，后续走队列分支且不再调用原 webContents', () => {
    const { wm } = makeManager()
    const uiWc = makeWc('ui')
    wm.setUITarget(asWc(uiWc))
    uiWc.destroyed = true

    const ok = send(wm, SAVE_STATE, 'acc', 'state')

    expect(ok).toBe(false)
    expect(uiWc.sent).toHaveLength(0)

    // 重新登记后：先前入队的白名单事件随 flush 一起到达，随后的 send 正常直投
    const fresh = makeWc('ui2')
    wm.setUITarget(asWc(fresh))
    expect(send(wm, IPC_CHANNELS.log, { level: 'info', message: 'x' })).toBe(true)
    expect(fresh.sent.map(x => x.channel)).toEqual([SAVE_STATE, IPC_CHANNELS.log])
    expect(wm.getQueueDepth('ui')).toBe(0)
  })
})

describe('windowManager 待发队列（TC-WQ3 ~ WQ6）', () => {
  it('TC-WQ3 白名单事件按 FIFO 入队，注册目标后按序 flush', () => {
    const { wm } = makeManager()

    expect(send(wm, SAVE_STATE, 'acc', 'state')).toBe(false)
    expect(send(wm, PROVIDERS_UPDATED, { p: 1 })).toBe(false)
    expect(send(wm, UPDATER_PROGRESS, { percent: 42 })).toBe(false)
    expect(wm.getQueueDepth('ui')).toBe(3)

    const uiWc = makeWc('ui')
    wm.setUITarget(asWc(uiWc))

    expect(uiWc.sent.map(x => x.channel)).toEqual([SAVE_STATE, PROVIDERS_UPDATED, UPDATER_PROGRESS])
    expect(uiWc.sent[2].args).toEqual([{ percent: 42 }])
    expect(wm.getQueueDepth('ui')).toBe(0)
  })

  it('TC-WQ4 非白名单通道直接丢弃，stderr 恰 1 条（限频）', () => {
    const { wm, lines } = makeManager()

    for (let i = 0; i < 5; i++) send(wm, NON_QUEUED, { chunk: `c${i}`, type: 'content' })

    expect(wm.getQueueDepth('ui')).toBe(0)
    expect(lines.filter(l => l.includes('丢弃非关键事件'))).toHaveLength(1)
  })

  it('TC-WQ5 超过 TTL 的待发事件在 flush 时丢弃并报一次', () => {
    const { wm, clock, lines } = makeManager()
    send(wm, SAVE_STATE, 'acc', 'stale')

    clock.t = 30_001 // 超过 30s
    const uiWc = makeWc('ui')
    wm.setUITarget(asWc(uiWc))

    expect(uiWc.sent).toHaveLength(0)
    expect(lines.filter(l => l.includes('过期丢弃'))).toHaveLength(1)
  })

  it('TC-WQ6 队列超容量丢最旧，容量 32，溢出报一次', () => {
    const { wm, lines } = makeManager()
    for (let i = 0; i < 33; i++) send(wm, SAVE_STATE, 'acc', `state-${i}`)

    expect(wm.getQueueDepth('ui')).toBe(32)

    const uiWc = makeWc('ui')
    wm.setUITarget(asWc(uiWc))

    // 第 0 条被丢掉，第一条存活
    expect(uiWc.sent).toHaveLength(32)
    expect(uiWc.sent[0].args).toEqual(['acc', 'state-1'])
    expect(lines.filter(l => l.includes('队列溢出'))).toHaveLength(1)
  })

  it('TC-WQ3b sendTo 可定向到 chrome / notice，互不干扰', () => {
    const { wm } = makeManager()
    const chromeWc = makeWc('chrome')
    const noticeWc = makeWc('notice')
    wm.setTarget('chrome', asWc(chromeWc))
    wm.setTarget('notice', asWc(noticeWc))

    sendTo(wm, 'chrome', IPC_CHANNELS.shell.tabsState, { tabs: [] })
    sendTo(wm, 'notice', IPC_CHANNELS.shell.notice, { kind: 'info', text: 'hi' })

    expect(chromeWc.sent).toHaveLength(1)
    expect(noticeWc.sent).toHaveLength(1)
    expect(chromeWc.sent[0].channel).toBe(IPC_CHANNELS.shell.tabsState)
    expect(noticeWc.sent[0].channel).toBe(IPC_CHANNELS.shell.notice)
  })
})

describe('windowManager 防递归与噪音（TC-WQ7 / WQ9）', () => {
  it('TC-WQ7 连续 100 次投递失败只产生 1 条失败告警', () => {
    const { wm, failures } = makeManager()
    const broken = makeWc('broken')
    broken.throwOnSend = true
    wm.setUITarget(asWc(broken))

    for (let i = 0; i < 100; i++) send(wm, NON_QUEUED, { chunk: `c${i}`, type: 'content' })

    expect(failures()).toHaveLength(1)
    expect(failures()[0]).toContain('推送失败')
  })

  it('TC-WQ9 正常投递不写 stderr（防噪音污染判据）', () => {
    const { wm, lines } = makeManager()
    const uiWc = makeWc('ui')
    wm.setUITarget(asWc(uiWc))

    send(wm, IPC_CHANNELS.log, { level: 'info', message: 'ok' })
    send(wm, SAVE_STATE, 'acc', 'ok-2')

    expect(lines).toEqual([])
  })
})
