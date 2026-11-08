import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { ElementContentMismatchedError, PageNotFoundError } from '#/errors/PlatformError'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { sleep } from '#/utils'
import { comment, connect, ensurePage, getAccountName, getItemFromVirtualScroller } from '../helper'
import type { ICommentListener, IPerformComment, IPerformPopup, IPlatform } from '../IPlatform'
import { KuaishouCommentListener } from './commentListener'
import { REGEXPS, SELECTORS, URLS } from './constant'
import { kuaishouElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '快手小店' as const

export class KuaishouPlatform
  implements IPlatform, IPerformPopup, IPerformComment, ICommentListener
{
  readonly _isPerformPopup = true
  readonly _isPerformComment = true
  readonly _isCommentListener = true
  private mainPage: Page | null = null
  private commentListener: KuaishouCommentListener | null = null

  async connect(browserSession: BrowserSession): Promise<boolean> {
    const { page } = browserSession
    await KuaishouCommentListener.hook(page)
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })

    if (isConnected) {
      // 快手小店会弹出莫名其妙的窗口，按 ESC 关闭
      let popover = await page
        .waitForSelector(SELECTORS.DRIVER_POPOVER, { timeout: 3000 })
        .catch(_ => null)
      while (popover) {
        await page.press('body', 'Escape')
        await sleep(1000)
        popover = await page.$(SELECTORS.DRIVER_POPOVER)
      }
      this.mainPage = page
    }

    return isConnected
  }

  async login(browserSession: BrowserSession): Promise<void> {
    if (!REGEXPS.LOGIN_PAGE.test(browserSession.page.url())) {
      await browserSession.page.goto(URLS.LOGIN_PAGE)
    }
    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession): Promise<string> {
    const accountName = await getAccountName(session.page, SELECTORS.ACCOUNT_NAME)
    return accountName ?? ''
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performComment(message: string, pinTop?: boolean) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, pinTop)),
    )
  }

  getCommentPage() {
    return this.mainPage
  }

  async performPopup(id: number) {
    if (!this.mainPage) {
      return Result.fail(new PageNotFoundError())
    }
    const item = await getItemFromVirtualScroller(this.mainPage, elementFinder, id)
    if (Result.isFailure(item)) {
      return item
    }
    const button = await elementFinder.getPopUpButtonFromGoodsItem(item.value)
    if (Result.isFailure(button)) {
      return button
    }
    const buttonText = (await button.value.textContent())?.trim() ?? ''
    if (buttonText !== '结束讲解' && buttonText !== '开始讲解') {
      return Result.fail(
        new ElementContentMismatchedError({
          current: buttonText,
          target: '结束讲解或开始讲解',
        }),
      )
    }
    // 已在讲解中（「结束讲解」= 当前正在讲）→ **直接视为本轮就绪、不点击**：
    // 旧实现会先点「结束讲解」再点「开始讲解」把讲解重启一次（无停顿的取消→重开），
    // 与抖店/百应的修复保持一致；下一个商品由 AutoPopupTask 的队列在下一轮推进。
    if (buttonText === '结束讲解') {
      return Result.succeed()
    }
    await button.value.dispatchEvent('click')
    // 判断是否会出现 modal
    const modalNextButton = await this.mainPage
      .waitForSelector(SELECTORS.goodsItem.POPUP_CONFIRM_BUTTON, {
        timeout: 500,
      })
      .catch(() => null)
    // 出现了就点击“确定”
    if (modalNextButton) {
      await modalNextButton.dispatchEvent('click')
    }
    return Result.succeed()
  }

  startCommentListener(onComment: (comment: LiveMessage) => void): void | Promise<void> {
    const page = ensurePage(this.mainPage)
    if (Result.isFailure(page)) {
      throw page.error
    }
    if (!this.commentListener) {
      this.commentListener = new KuaishouCommentListener(page.value)
    }
    this.commentListener.startCommentListener(onComment)
  }

  stopCommentListener(): void {
    this.commentListener?.stopCommentListener()
  }
  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new Error('Comment listener not started')
    }
    return this.commentListener.getPage()
  }

  getPopupPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
