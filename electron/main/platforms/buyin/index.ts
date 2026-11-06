import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import type { PlatformError } from '#/errors/PlatformError'
import { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { DouyinPlatform } from '../douyin'
import { CompassListener, ControlListener } from '../douyin/commentListener'
// 百应和抖店共用
import { connect, ensurePage, openUrlByElement } from '../helper'
import {
  type ICommentListener,
  type ILiveStatusWatcher,
  type IPerformComment,
  type IPerformPopup,
  type IPlatform,
  type ISendRedPacket,
  isControlPageUrlIn,
} from '../IPlatform'
import { createLiveStatusWatcher } from '../liveStatusWatcher'
import { CONTROL_PAGE, OWNED_ORIGINS, REGEXPS, SELECTORS, URLS } from './constant'

const PLATFORM_NAME = '巨量百应' as const

/**
 * 巨量百应
 */
export class BuyinPlatform
  implements
    IPlatform,
    IPerformPopup,
    IPerformComment,
    ICommentListener,
    ISendRedPacket,
    ILiveStatusWatcher
{
  readonly _isSendRedPacket = true
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  readonly _isCommentListener = true
  readonly _isLiveStatusWatcher = true
  readonly ownedOrigins = OWNED_ORIGINS

  private mainPage: Page | null = null
  /** 会话引用（罗盘监听需要 BrowserSession 提供的 aux 页能力；attach 下 context.newPage 不可用） */
  private browserSession: BrowserSession | null = null
  private commentListener: ICommentListener | null = null
  private liveWatcher: { start(): void; stop(): void } | null = null

  get platformName() {
    return PLATFORM_NAME
  }

  /** 中控台页面身份判据（A2）：下播观测/导航告警用它区分「页面漂移」与「真实下播」 */
  isControlPageUrl(url: string): boolean {
    return isControlPageUrlIn(url, CONTROL_PAGE)
  }

  async connect(browserSession: BrowserSession) {
    this.browserSession = browserSession
    const { page } = browserSession
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL_PAGE,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })
    if (isConnected) {
      // 2025.11 巨量百应的中控台和登录时一样，样式会乱，同样的解决方法
      // attach 铁律：fold 回退返回原页面时禁止 close（同 douyin.login 注释）
      //
      // 弹窗语义（Phase 2 契约）：此刻登录窗口期已结束，会话层已复位为浏览器语义；
      // 但这次「控件点击打开中控台」依赖旧语义（弹窗折叠回当前页）才能拿到中控页，
      // 因此显式声明 'navigate' 包住本次自动化调用，finally 立即复位。
      // launched 会话无 setPopupMode 能力（可选字段）→ 行为不变。
      browserSession.setPopupMode?.('navigate')
      try {
        const newPage = await openUrlByElement(page, URLS.LIVE_CONTROL_PAGE)
        browserSession.page = newPage
        this.mainPage = newPage
        if (newPage !== page) {
          await page.close()
        }
      } finally {
        browserSession.setPopupMode?.(null)
      }
    }
    return isConnected
  }

  async login(browserSession: BrowserSession) {
    // 进入登录页面
    // 巨量百应（2025.8）也有和抖店同样的问题
    // 解决方法：通过控件主动打开登录页面
    // attach 铁律：fold 回退返回原页面时禁止 close（同 douyin.login 注释）
    const newPage = await openUrlByElement(browserSession.page, URLS.LOGIN_PAGE)
    if (newPage !== browserSession.page) {
      await browserSession.page.close()
    }
    browserSession.page = newPage

    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession) {
    await session.page.waitForSelector(SELECTORS.ACCOUNT_NAME)
    const accountName = await session.page.$(SELECTORS.ACCOUNT_NAME).then(el => el?.textContent())
    return accountName ?? ''
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(...args: Parameters<IPerformPopup['performPopup']>) {
    return await DouyinPlatform.prototype.performPopup.call(this, ...args)
  }

  sendRedPacket(
    ...args: Parameters<ISendRedPacket['sendRedPacket']>
  ): Result.ResultAsync<void, PlatformError> {
    return DouyinPlatform.prototype.sendRedPacket.call(this, ...args)
  }

  getRedPacketPage(): Page | null {
    return this.mainPage
  }

  async performComment(message: string, pinTop: boolean) {
    return await DouyinPlatform.prototype.performComment.call(this, message, pinTop)
  }

  startCommentListener(onComment: (comment: LiveMessage) => void, source: 'control' | 'compass') {
    const pageResult = ensurePage(this.mainPage)
    if (Result.isFailure(pageResult)) {
      throw pageResult.error
    }
    const page = pageResult.value
    if (source === 'control') {
      this.commentListener = new ControlListener(page)
    } else {
      // 罗盘大屏需要独立页面：attach 壳模式下 context.newPage() 不可用，
      // 必须消费 BrowserSession.createAuxPage 能力（壳内隐藏页 + nonce 寻址）
      this.commentListener = new CompassListener('buyin', page, {
        createAuxPage: this.browserSession?.createAuxPage,
      })
    }
    return this.commentListener.startCommentListener(onComment, source)
  }

  stopCommentListener(): void {
    this.commentListener?.stopCommentListener()
  }

  startLiveStatusWatch(onLiveEnd: () => void) {
    const logger = createLogger('LiveStatus')
    // 选择器经 ...DY_SELECTORS 继承自抖店（直播总结弹窗/直播中 tag 两者同源）
    this.liveWatcher = createLiveStatusWatcher({
      getPage: () => this.mainPage,
      signals: {
        checkLive: async page => (await page.$(SELECTORS.LIVE_TAG)) !== null,
        checkEnded: async page => {
          const el = await page.$(SELECTORS.overlays.LIVE_OVER_CLOSE_BUTTON)
          if (!el) return false
          await el.dispatchEvent('click').catch(() => {})
          return true
        },
      },
      // 页面身份护栏（A2/A3）：「看不到信号」≠「下播」，页面漂移时 watcher 不计数不 fire
      isObservingPage: async page => this.isControlPageUrl(page.url()),
      onUnobservable: () => logger.warn('中控台页面已离开，已暂停下播判定'),
      onLiveEnd,
      logger,
    })
    this.liveWatcher.start()
  }

  stopLiveStatusWatch() {
    this.liveWatcher?.stop()
    this.liveWatcher = null
  }

  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new Error('未找到评论监听页面')
    }
    return this.commentListener?.getCommentListenerPage() ?? this.mainPage
  }

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }
}
