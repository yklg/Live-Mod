import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import {
  comment,
  connect,
  ensurePage,
  getAccountName,
  getItemFromVirtualScroller,
  toggleButton,
} from '../helper'
import {
  type IPerformComment,
  type IPerformPopup,
  type IPlatform,
  isControlPageUrlIn,
} from '../IPlatform'
import { CONTROL_PAGE, OWNED_ORIGINS, REGEXPS, SELECTORS, TEXTS, URLS } from './constant'
import { douyinEosElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '抖音团购' as const

/**
 * 抖音团购
 */
export class DouyinEosPlatform implements IPlatform, IPerformPopup, IPerformComment {
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  readonly ownedOrigins = OWNED_ORIGINS
  public mainPage: Page | null = null

  /**
   * 中控台页面身份判据（A2）：团购未实现 liveStatusWatcher，本方法先补齐平台契约，
   * 供会话层导航告警/未来下播观测使用（登录页 /livesite/login 不算中控台）。
   */
  isControlPageUrl(url: string): boolean {
    return isControlPageUrlIn(url, CONTROL_PAGE)
  }

  async connect(browserSession: BrowserSession) {
    const { page } = browserSession
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })
    if (isConnected) {
      this.mainPage = page
    }
    return isConnected
  }

  async login(browserSession: BrowserSession) {
    if (!REGEXPS.LOGIN_PAGE.test(browserSession.page.url())) {
      await browserSession.page.goto(URLS.LOGIN_PAGE)
    }
    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession) {
    const accountName = await getAccountName(session.page, SELECTORS.ACCOUNT_NAME)
    return accountName ?? ''
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(id: number, signal?: AbortSignal) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getItemFromVirtualScroller(page, elementFinder, id)),
      Result.andThen(item => elementFinder.getPopUpButtonFromGoodsItem(item)),
      Result.andThen(popupBtn =>
        toggleButton(popupBtn, TEXTS.POPUP_BUTTON, TEXTS.POPUP_BUTTON_CANCLE, signal),
      ),
    )
  }

  async performComment(message: string) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, false)),
    )
  }

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
