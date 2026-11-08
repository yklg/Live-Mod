import { EventEmitter } from 'node:events'
import type { Page, Response } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 评论监听契约测试（D 修复回归）=====
// 背景（P0）：ControlListener 的 isRunning 全文件从未置 true → keepPageRunning 是死代码；
// 官方页 comment/info 返回 200+空体时 response.json() 抛错且无人处理 → 永远无评论的静默失败；
// stop 不清保活定时器。CompassListener 在 attach 下 context.newPage() 不可用（缺 aux 页能力）。
// 用 fake page（EventEmitter + $/goto 计数）+ mock logger/windowManager 验证上述契约。

const h = vi.hoisted(() => {
  const loggerStub = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    scope: vi.fn(),
  }
  loggerStub.scope.mockReturnValue(loggerStub)
  const toastSends: Array<{ target: string; channel: string; message: string }> = []
  return { loggerStub, toastSends }
})

vi.mock('#/logger', () => ({ createLogger: () => h.loggerStub }))
vi.mock('#/windowManager', () => ({
  default: {
    // 返回值必须是 boolean（真实 WindowManager.sendTo 契约）：W3 起调用方会读返回值做失败计数，
    // 返回 push() 的数字会让「投递失败判定」失去意义 —— 见 TC-RG1。
    sendTo: (target: string, channel: string, message: string) => {
      h.toastSends.push({ target, channel, message })
      return true
    },
  },
}))

import { CompassListener, ControlListener } from '../douyin/commentListener'
import { SELECTORS } from '../douyin/constant'

/** fake page：EventEmitter 支撑 page.on('response')；$ 记录查询 + 恒 null；context.newPage 可编程 */
class FakePage extends EventEmitter {
  readonly queriedSelectors: string[] = []
  readonly visitedUrls: string[] = []
  readonly contextNewPageCalls = { n: 0 }
  /** 设置后 context().newPage() 才可用（未设置即断言「不应走回退路径」） */
  contextPageFactory: (() => FakePage) | null = null

  async $(selector: string): Promise<null> {
    this.queriedSelectors.push(selector)
    return null
  }

  async goto(url: string): Promise<void> {
    this.visitedUrls.push(url)
  }

  async waitForSelector(): Promise<null> {
    return null
  }

  locator() {
    return { evaluate: async () => {} }
  }

  async close(): Promise<void> {}

  isClosed(): boolean {
    return false
  }

  url(): string {
    return 'https://fxg.jinritemai.com/ffa/content-tool/live/control'
  }

  context() {
    return {
      newPage: async () => {
        this.contextNewPageCalls.n++
        if (!this.contextPageFactory) throw new Error('不应调用 context.newPage()')
        return this.contextPageFactory()
      },
    }
  }
}

const fakeResponse = (url: string, json: () => Promise<unknown>) =>
  ({ url: () => url, json }) as unknown as Response

/** 冲刷 async 链（保活动作/响应解析都在微任务里） */
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.toastSends.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ControlListener（D1：isRunning 死代码修复 + 定时器生命周期）', () => {
  it('TC-C1 [死代码修复] start 置 isRunning 后保活动作真正执行（仅点新评论按钮）', async () => {
    const page = new FakePage()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(vi.fn())
    await flush()
    // 修复前：isRunning 恒 false → keepPageRunning 首行 return，$ 一次都不会被调用
    expect(page.queriedSelectors.length).toBeGreaterThan(0)
    expect(page.queriedSelectors).toContain(SELECTORS.NEW_COMMENT_LABEL)
    // 审查后收窄（P1-3）：保活**不得**通用点击 overlays——
    // AFK_CLOSE_BUTTON 是任意 auxo 弹窗主按钮（会误触真实配置弹窗），LIVE_OVER 必须留给下播判定独享。
    expect(page.queriedSelectors).not.toContain(SELECTORS.overlays.AFK_CLOSE_BUTTON)
    expect(page.queriedSelectors).not.toContain(SELECTORS.overlays.LIVE_OVER_CLOSE_BUTTON)
    listener.stopCommentListener()
  })

  it('TC-C2 [timer 生命周期] 保活 3s 自递归；stop 清 timer 后不再触碰页面', async () => {
    const page = new FakePage()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(vi.fn())
    await flush()
    const firstRound = page.queriedSelectors.length
    expect(firstRound).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(3000) // 第二轮保活
    expect(page.queriedSelectors.length).toBeGreaterThan(firstRound)

    listener.stopCommentListener()
    expect(vi.getTimerCount()).toBe(0) // 保活 + 探针定时器都已清理
    const frozen = page.queriedSelectors.length
    await vi.advanceTimersByTimeAsync(15_000)
    expect(page.queriedSelectors.length).toBe(frozen) // 无旧递归链泄漏
    expect(vi.getTimerCount()).toBe(0)
  })

  it('TC-C3 [行为锚不变] 只解析 comment/info? 且按 data.comment_infos 派发评论', async () => {
    const page = new FakePage()
    const onComment = vi.fn()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(onComment)
    await flush()

    page.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/anchor/comment/info?room=1', async () => ({
        data: {
          comment_infos: [{ comment_id: 'c1', nick_name: '张三', content: '你好' }],
        },
      })),
    )
    await flush()
    expect(onComment).toHaveBeenCalledTimes(1)
    expect(onComment.mock.calls[0][0]).toMatchObject({
      msg_id: 'c1',
      nick_name: '张三',
      content: '你好',
      msg_type: 'comment',
    })

    // 非匹配接口不解析（解析函数会抛错，若被误解析则测试失败）
    page.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/anchor/other', async () => {
        throw new Error('不应被解析')
      }),
    )
    await flush()
    expect(onComment).toHaveBeenCalledTimes(1)
    listener.stopCommentListener()
  })

  it('TC-C6 [幂等] start 双调不重复挂监听：一次响应只派发一次、只有一份定时器', async () => {
    const page = new FakePage()
    const first = vi.fn()
    const second = vi.fn()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(first)
    listener.startCommentListener(second) // 第二次只更新回调，不重复挂 response/保活
    await flush()

    page.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/anchor/comment/info?room=1', async () => ({
        data: { comment_infos: [{ comment_id: 'c1', nick_name: 'a', content: 'hi' }] },
      })),
    )
    await flush()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    listener.stopCommentListener()
  })
})

describe('ControlListener 评论通道存活探针（D2：不静默、不停止监听）', () => {
  it('TC-C4 [P0 故障形态] 200+空体解析失败 → warn 不静默；30s 无数据 → warnToast 一次；不停止监听', async () => {
    const page = new FakePage()
    const onComment = vi.fn()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(onComment)
    await flush()

    // 现网实测：HTTP 200 + 空响应体 → response.json() 抛 SyntaxError（修复前完全静默）
    page.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/anchor/comment/info?room=1', async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      }),
    )
    await flush()
    expect(h.loggerStub.warn).toHaveBeenCalled()
    expect(onComment).not.toHaveBeenCalled()

    // 30s 没有非空评论 → warn + 壳 UI toast（恰好一次 / 60s 冷却）
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.toastSends).toHaveLength(1)
    expect(h.toastSends[0]).toMatchObject({ target: 'ui', channel: 'shell:warnToast' })
    expect(h.toastSends[0]?.message).toContain('评论通道 30 秒无数据')

    await vi.advanceTimersByTimeAsync(25_000) // t=55s：冷却未到，不重复
    expect(h.toastSends).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(40_000) // t=95s：越过 30s+60s → 再次告警
    expect(h.toastSends).toHaveLength(2)

    // 不停止监听：保活链仍在运行（评论恢复后仍会正常派发）
    const queried = page.queriedSelectors.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(page.queriedSelectors.length).toBeGreaterThan(queried)
    listener.stopCommentListener()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('TC-C5 [无请求不告警] 从未观测到 comment/info 响应时探针静默（未开播待命不误报）', async () => {
    const page = new FakePage()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(vi.fn())
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.toastSends).toHaveLength(0)
    listener.stopCommentListener()
  })

  it('TC-C7 [空列表/异常体] 空 comment_infos 不重置静默计时；非数组体 warn 不静默且不抛', async () => {
    const page = new FakePage()
    const onComment = vi.fn()
    const listener = new ControlListener(page as unknown as Page)
    listener.startCommentListener(onComment)
    await flush()

    // 合法空列表：通道活着但暂无新评论 → 不派发；不重置「最近非空数据」计时 → 探针仍会告警
    page.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/anchor/comment/info?room=1', async () => ({
        data: { comment_infos: [] },
      })),
    )
    await flush()
    expect(onComment).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.toastSends).toHaveLength(1)

    // 响应体形状非预期：warn 不静默、不 throw、不影响后续监听
    page.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/anchor/comment/info?room=1', async () => ({})),
    )
    await flush()
    expect(h.loggerStub.warn).toHaveBeenCalledWith(expect.stringContaining('data.comment_infos'))
    listener.stopCommentListener()
  })
})

describe('CompassListener aux 页能力（F6：attach 下 context.newPage 不可用）', () => {
  /** 让 getLiveRoomId 拿到直播间 ID：主页面回一条 promotions_v2 响应 */
  async function settleRoomId(mainPage: FakePage) {
    await flush()
    mainPage.emit(
      'response',
      fakeResponse('https://fxg.jinritemai.com/api/promotions_v2?room=1', async () => ({
        data: { room_id: 'room-123' },
      })),
    )
    await flush()
  }

  it('TC-C8 [aux 优先] 提供 createAuxPage 时罗盘大屏建在该页，不走 context.newPage', async () => {
    const mainPage = new FakePage()
    const auxPage = new FakePage()
    const createAuxPage = vi.fn(async () => auxPage as unknown as Page)
    const listener = new CompassListener('douyin', mainPage as unknown as Page, { createAuxPage })

    const started = listener.startCommentListener(vi.fn())
    await settleRoomId(mainPage)
    await started

    expect(createAuxPage).toHaveBeenCalledTimes(1)
    expect(mainPage.contextNewPageCalls.n).toBe(0) // attach：绝不回退 context.newPage
    expect(auxPage.visitedUrls).toHaveLength(2) // 罗盘主页 → 大屏
    expect(auxPage.visitedUrls[0]).toContain('compass.jinritemai.com')
    expect(auxPage.visitedUrls[1]).toContain('room-123')
    expect(listener.getCommentListenerPage()).toBe(auxPage)
    listener.stopCommentListener()
  })

  it('TC-C9 [回退兼容] 未提供 createAuxPage（launched/旧调用方）时保持 context.newPage 原行为', async () => {
    const mainPage = new FakePage()
    const fallbackPage = new FakePage()
    mainPage.contextPageFactory = () => fallbackPage
    const listener = new CompassListener('buyin', mainPage as unknown as Page)

    const started = listener.startCommentListener(vi.fn())
    await settleRoomId(mainPage)
    await started

    expect(mainPage.contextNewPageCalls.n).toBe(1)
    expect(fallbackPage.visitedUrls).toHaveLength(2)
    expect(fallbackPage.visitedUrls[1]).toContain('room-123')
    listener.stopCommentListener()
  })
})
