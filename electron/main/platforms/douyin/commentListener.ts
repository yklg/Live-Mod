import type { Page, Response } from 'playwright'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import type { ICommentListener } from '../IPlatform'
import { SELECTORS, URLS } from './constant'

/** 评论监听日志域：解析失败/通道存活告警都走这里——禁止静默失败 */
const logger = createLogger('CommentListener')

// ===== 评论通道存活探针（P0 修复）=====
// 背景：壳内 attach 实测官方页 `comment/info` 返回 HTTP 200 + 空响应体，
// 原 ControlListener 的 `response.json()` 直接抛错且无人处理 → 「监听已开始但永远没有评论」的静默失败。
// 契约：运行中且至少观测到过一次 `comment/info` 响应后，若连续 30s 没有解析出非空评论，
// 显式 warn（日志）+ warnToast（壳 UI 提示）；每 60s 最多告警一次，且绝不停止监听。
const COMMENT_PROBE_INTERVAL_MS = 5000
const COMMENT_SILENCE_WARN_MS = 30_000
const COMMENT_SILENCE_WARN_COOLDOWN_MS = 60_000
/** 页面保活间隔（保留原 sleep(3000) 语义） */
const KEEP_PAGE_RUNNING_INTERVAL_MS = 3000

export class ControlListener implements ICommentListener {
  readonly _isCommentListener = true

  private isRunning = false
  private handleComment: (comment: DouyinLiveMessage) => void = () => {}
  private keepAliveTimer: ReturnType<typeof setTimeout> | null = null
  private probeTimer: ReturnType<typeof setInterval> | null = null
  private startedAt = 0
  /** 最近一次解析出「非空评论」的时间；0 = 本次监听尚未拿到过数据 */
  private lastCommentDataAt = 0
  /** 是否观测到过 comment/info 响应（响应到达 = 至少发出过请求；没请求就不告警，避免未开播待命误报） */
  private hasSeenCommentResponse = false
  private lastWarnAt = 0
  /** 解析失败告警冷却（空响应故障下每 ~3s 一条响应，不能每响应一条 warn 刷屏） */
  private lastParseWarnAt = 0

  constructor(private page: Page) {
    this.handleResponse = this.handleResponse.bind(this)
  }

  startCommentListener(onComment: (comment: DouyinLiveMessage) => void) {
    this.handleComment = onComment
    // 幂等：避免重复挂 response 监听 / 双份保活与探针定时器
    if (this.isRunning) return
    this.isRunning = true
    this.startedAt = Date.now()
    this.lastCommentDataAt = 0
    this.hasSeenCommentResponse = false
    this.lastWarnAt = 0
    this.lastParseWarnAt = 0
    this.page.on('response', this.handleResponse)
    // 死代码修复：isRunning 置位后「关遮罩/点新评论」保活逻辑才真正执行
    this.keepPageRunning()
    this.probeTimer = setInterval(() => this.checkCommentChannelAlive(), COMMENT_PROBE_INTERVAL_MS)
  }

  stopCommentListener() {
    this.isRunning = false
    this.page.off('response', this.handleResponse)
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer)
      this.probeTimer = null
    }
  }

  private async handleResponse(response: Response) {
    // 匹配规则是行为锚：只认 comment/info?（官方中控台自身轮询的评论接口）
    if (!response.url().includes('comment/info?')) return
    // 响应到达即证明「至少发出过请求」：探针在此之前不告警
    this.hasSeenCommentResponse = true
    try {
      const body = await response.json()
      const commentInfos = body?.data?.comment_infos
      if (!Array.isArray(commentInfos)) {
        // 非预期响应体：显式记录，不静默
        logger.warn('评论响应缺少 data.comment_infos，已跳过本轮（监听继续）')
        return
      }
      // 空列表 = 通道正常但暂无新评论，不计入「非空评论数据」
      if (commentInfos.length === 0) return
      this.lastCommentDataAt = Date.now()
      for (const comment of commentInfos) {
        const commentData: DouyinLiveMessage = {
          msg_id: comment.comment_id,
          nick_name: comment.nick_name,
          content: comment.content,
          msg_type: 'comment',
          time: Date.now(),
        }
        this.handleComment(commentData)
      }
    } catch (error) {
      // 实测故障形态：HTTP 200 + 空响应体 → response.json() 抛 SyntaxError。
      // 显式但不刷屏：解析失败每条响应都会发生（~3s），warn 每 60s 最多一次，其余降 verbose；
      // 持续无数据的用户可见告警由 30s 存活探针负责（不静默、不停止监听）。
      const now = Date.now()
      if (now - this.lastParseWarnAt >= 60_000) {
        this.lastParseWarnAt = now
        logger.warn('评论响应解析失败（已跳过本轮，监听继续；同类告警 60s 内不再重复）：', error)
      } else {
        logger.verbose('评论响应解析失败（已跳过本轮）：', error)
      }
    }
  }

  /**
   * 页面保活（死代码修复）：start 置位 isRunning 后才会真正生效。
   * 用 setTimeout 自递归 + 保存 timer 替代原来的 await sleep 递归：
   * stop 时 clearTimeout，杜绝旧递归链在停止后继续操作页面；try/finally 保证动作异常也不断链。
   */
  private keepPageRunning() {
    if (!this.isRunning) return
    void this.runKeepAliveActions().finally(() => {
      if (!this.isRunning) return
      this.keepAliveTimer = setTimeout(() => this.keepPageRunning(), KEEP_PAGE_RUNNING_INTERVAL_MS)
    })
  }

  /**
   * 保活动作：有新评论时点刷新按钮；失败只记 verbose，不打断监听。
   *
   * 刻意**不点 SELECTORS.overlays**：`AFK_CLOSE_BUTTON` 是「任意 auxo 弹窗主按钮」的通用选择器，
   * 每 3s 自动点会误触真实配置弹窗（作废/确定等），风险高于收益；`LIVE_OVER_CLOSE_BUTTON` 是
   * 下播判定确定信号，必须由 liveStatusWatcher 独自消费，保活抢先点掉会让下播检测失效。
   * 防 AFK 弹窗/恢复直播弹窗的自动处理需真机确认专用选择器后单独接入（列入验收清单）。
   */
  private async runKeepAliveActions() {
    try {
      const newCommentButton = await this.page.$(SELECTORS.NEW_COMMENT_LABEL)
      if (newCommentButton) await newCommentButton.dispatchEvent('click')
    } catch (error) {
      // 页面导航瞬间节点脱离等：跳过本轮，保活链由 finally 继续
      logger.verbose('页面保活动作失败，已跳过本轮：', error)
    }
  }

  /**
   * 评论通道存活探针：连续 30s 没有「非空评论数据」即显式告警（日志 + 壳 UI toast）。
   * 不停止监听——通道恢复后评论仍会正常处理；告警每 60s 最多一次防刷屏。
   */
  private checkCommentChannelAlive() {
    if (!this.isRunning || !this.hasSeenCommentResponse) return
    const now = Date.now()
    // 从未拿到数据时以「开始监听」为静默起点
    const silenceSince = this.lastCommentDataAt || this.startedAt
    if (now - silenceSince < COMMENT_SILENCE_WARN_MS) return
    if (now - this.lastWarnAt < COMMENT_SILENCE_WARN_COOLDOWN_MS) return
    this.lastWarnAt = now
    const message = '评论通道 30 秒无数据，请检查中控台页面/网络'
    // 不静默：日志落盘 + 壳 UI warnToast（经典模式该通道无人监听，无副作用）
    logger.warn(message)
    windowManager.sendTo('ui', IPC_CHANNELS.shell.warnToast, message)
  }

  getCommentListenerPage(): Page {
    return this.page
  }
}

interface CompassMessageResponse {
  data: {
    messages: {
      // 评论
      comment: CommentMessage[] | null
      // 进入直播间
      room_enter?: RoomEnterMessage[]
      // 点赞
      room_like?: RoomLikeMessage[]
      // 加入品牌会员
      subscribe_merchant_brand_vip?: SubscribeMerchantBrandVipMessage[]
      // 关注
      room_follow?: RoomFollowMessage[]
      // 加入粉丝团
      ecom_fansclub_participate?: EcomFansclubParticipateMessage[]
    }
  }
}

interface LiveOrderResponse {
  data: {
    item_num: number
    nick_name: string
    order_id: string
    order_status: number // 已知： 3 -> 已支付          0 -> 已下单
    order_ts: number
    product_id: string
    product_title: string
  }[]
  msg: string
}

/**
 * 罗盘监听辅助页能力（attach 壳模式必需）：
 * `connectOverCDP` 下 `context.newPage()` 抛 `Target.createTarget: Not supported`，
 * 必须由 BrowserSession.createAuxPage 提供壳内可用承载页（隐藏窗口 + nonce 寻址）。
 * 未提供时（旧调用方/launched 兜底）才退回 `context.newPage()`。
 */
export interface CompassListenerOptions {
  createAuxPage?: (opts?: { url?: string }) => Promise<Page>
}

export class CompassListener implements ICommentListener {
  readonly _isCommentListener = true

  protected compassPage: Page | undefined
  private handleComment: (comment: DouyinLiveMessage) => void = () => {}
  constructor(
    private platform: 'buyin' | 'douyin',
    protected page: Page,
    private options: CompassListenerOptions = {},
  ) {}

  protected async connectCompass() {
    const getLiveRoomId = () => {
      return new Promise<string>((resolve, reject) => {
        const page = this.page
        const handleResponse = async (response: Response) => {
          const url = response.url()
          if (url.includes('promotions_v2?')) {
            const resData = await response.json()
            const roomId = resData?.data?.room_id
            if (roomId) {
              page.off('response', handleResponse)
              // this.logger.debug(`获取直播间 ID成功: ${roomId}`)
              resolve(roomId)
            }
          }
        }
        page.on('response', handleResponse)
        setTimeout(() => {
          page.off('response', handleResponse)
          reject(new Error('找不到直播间 ID，可能直播间已关闭'))
        }, 10000)
      })
    }

    const liveRoomId = await getLiveRoomId()

    const browserContext = this.page.context()
    // attach：走会话层 aux 页能力（壳内隐藏窗口 + nonce 寻址，登录态同 partition）；
    // launched/旧调用方：保持 context.newPage() 原行为
    this.compassPage = this.options.createAuxPage
      ? await this.options.createAuxPage()
      : await browserContext.newPage()

    // 失败必须回收 aux 载体：attached 的 aux 是隐藏 BrowserWindow，泄漏会留下不可见窗口
    const compassPage = this.compassPage
    try {
      await compassPage.goto(
        this.platform === 'douyin'
          ? URLS.DOUYIN_COMPASS_INDEX_PREFIX
          : URLS.BUYIN_COMPASS_INDEX_PREFIX,
      )
      // this.logger.debug('正在尝试登录电商罗盘')
      // 等待罗盘自动登录
      await compassPage.waitForSelector(SELECTORS.COMPASS_LOGGED_IN)
      // this.logger.debug('登录成功，正在进入大屏')
      // 再进入大屏
      await compassPage.goto(
        `${
          this.platform === 'douyin'
            ? URLS.DOUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID
            : URLS.BUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID
        }${liveRoomId}`,
      )
      // 删除中间的直播画面，减少不必要的资源占用
      compassPage.locator('video').evaluate(el => {
        const video = el as HTMLVideoElement
        // 删太快也不行，找不到更好的方法之前只能死等一会了
        setTimeout(() => {
          video.pause()
          video.removeAttribute('src')
          video.load()
          video.remove()
        }, 3000)
      })
      // this.logger.debug('大屏进入成功')
    } catch (error) {
      try {
        await compassPage.close()
      } catch {
        // 页已销毁/连接已断：忽略清理失败，保留原始错误
      }
      this.compassPage = undefined
      throw error
    }
  }

  private listenResponse() {
    const handleResponse = async (response: Response) => {
      const url = response.url()
      if (url.includes('message?')) {
        const data: CompassMessageResponse = await response.json()
        this.handleMessageResponse(data)
      } else if (url.includes('live_order_stream?')) {
        const data: LiveOrderResponse = await response.json()
        this.handleLiveOrderResponse(data)
      }
    }

    this.compassPage?.on('response', handleResponse)
  }

  private handleMessageResponse(data: CompassMessageResponse) {
    for (const messages of Object.values(data.data.messages)) {
      if (!messages) continue
      for (const message of messages) {
        const comment = { ...message, time: Date.now() }
        this.handleComment(comment)
      }
    }
  }

  private handleLiveOrderResponse(data: LiveOrderResponse) {
    const messages: LiveOrderMessage[] = data.data.map(item => {
      let order_status: LiveOrderMessage['order_status'] = '未知状态'
      // TODO: 不确定已下单对应的是多少！
      if (item.order_status <= 1) {
        order_status = '已下单'
      } else if (item.order_status === 3) {
        order_status = '已付款'
      }
      return {
        msg_type: 'live_order',
        msg_id: `${item.order_id}#${item.order_status}`,
        nick_name: item.nick_name,
        order_status,
        order_ts: item.order_ts,
        product_id: item.product_id,
        product_title: item.product_title,
      }
    })
    for (const message of messages) {
      const comment = {
        ...message,
        time: Date.now(),
      }
      this.handleComment(comment)
    }
  }

  async startCommentListener(onComment: (comment: DouyinLiveMessage) => void) {
    this.handleComment = onComment
    await this.connectCompass()
    this.listenResponse()
  }

  stopCommentListener() {
    this.compassPage?.removeAllListeners('response')
    this.compassPage?.close()
  }

  getCommentListenerPage(): Page {
    return this.compassPage ?? this.page
  }
}
