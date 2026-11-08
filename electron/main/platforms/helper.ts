import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { UnexpectedError } from '#/errors/AppError'
import {
  ElementContentMismatchedError,
  ElementDisabledError,
  ElementNotFoundError,
  MaxTryCountExceededError,
  PageNotFoundError,
  type PlatformError,
} from '#/errors/PlatformError'
import { abortableSleep, sleep } from '#/utils'
import type { IElementFinder } from './IElementFinder'

export async function connect(
  page: Page,
  loginConstants: {
    liveControlUrl: string
    loginUrlRegex: RegExp
    isInLiveControlSelector: string
  },
) {
  await page.goto(loginConstants.liveControlUrl, {
    waitUntil: 'domcontentloaded',
  })
  await Promise.race([
    page.waitForURL(loginConstants.loginUrlRegex, {
      timeout: 0,
      waitUntil: 'domcontentloaded',
    }),
    page.waitForSelector(loginConstants.isInLiveControlSelector, {
      timeout: 0,
      state: 'attached',
    }),
  ])

  const isConnected = !loginConstants.loginUrlRegex.test(page.url())
  return isConnected
}

export async function getAccountName(page: Page, accountNameSelector: string) {
  return page.waitForSelector(accountNameSelector).then(el => el.textContent())
}

export async function comment(
  page: Page,
  elementFinder: IElementFinder,
  message: string,
  pinTop?: boolean,
): Result.ResultAsync<boolean, PlatformError> {
  async function clickPinTopButton(page: Page): Result.ResultAsync<boolean, PlatformError> {
    return Result.pipe(
      elementFinder.getPinTopLabel(page),
      Result.inspect(label => label.dispatchEvent('click')),
      Result.map(_ => true),
      // 即使没有 pinTop 也不会中断程序
      Result.orElse(_ => Result.succeed(false)),
    )
  }

  return Result.pipe(
    // 评论框
    elementFinder.getCommentTextarea(page),
    // 填写评论内容
    Result.inspect(textarea => textarea.fill(message, { timeout: 5000 })),
    // 点击置顶选项
    Result.andThen(_ => (pinTop ? clickPinTopButton(page) : Result.succeed(false))),
    // 发送评论
    Result.andThrough(_ =>
      Result.pipe(
        // 直接点击发送评论按钮
        elementFinder.getClickableSubmitCommentButton(page),
        Result.inspect(btn => btn.dispatchEvent('click')),
        // 下策：尝试直接用 Enter 发送评论
        Result.orElse(err => {
          if (err.name === 'ElementNotFoundError') {
            return Result.pipe(
              elementFinder.getCommentTextarea(page),
              Result.andThen(textarea => {
                return Result.try({
                  try: () => textarea.press('Enter'),
                  catch: _ => err,
                  immediate: true,
                })
              }),
            )
          }
          return Result.fail(err)
        }),
      ),
    ),
  )
}

/** 在虚拟列表中找到目标序号的位置 */
export async function getItemFromVirtualScroller(
  page: Page,
  elementFinder: IElementFinder,
  targetId: number,
  maxRetries = 10,
): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError> {
  const SCROLL_TOLERANCE = 10
  const LOAD_WAIT_MS = 1000

  /**
   * 在当前渲染的DOM节点中查找具有特定ID的商品。
   */
  async function findItemInCurrentView(id: number) {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }
    try {
      // 并发执行，效率比顺序遍历快了10倍以上
      const foundItem = await Promise.any(
        currentGoodsItems.value.map(async goodsItem => {
          const itemIdResult = await elementFinder.getIdFromGoodsItem(goodsItem)
          if (Result.isSuccess(itemIdResult) && itemIdResult.value === id) {
            return goodsItem
          }
          throw new Error('未匹配')
        }),
      )
      return Result.succeed(foundItem)
    } catch (err) {
      // Promise.any 全部出错抛出的错误为 AggregateError
      // 表示全部都未找到
      if (err instanceof AggregateError) {
        return Result.succeed(null)
      }
      return Result.fail(new UnexpectedError({ cause: err }))
    }
  }

  /**
   * 根据目标ID和当前列表的ID范围，决定下一个滚动的锚点元素（列表的第一个或最后一个）。
   */
  async function determineScrollTarget(
    id: number,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError> {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }

    const firstItem = currentGoodsItems.value[0]
    const lastItem = currentGoodsItems.value[currentGoodsItems.value.length - 1]

    return Result.pipe(
      Result.sequence([
        elementFinder.getIdFromGoodsItem(firstItem),
        elementFinder.getIdFromGoodsItem(lastItem),
      ]),
      Result.andThen(([firstId, lastId]) => {
        // 判断列表是正序还是倒序
        const isReversed = firstId > lastId
        // logger.warn(`商品 ${id} 不在当前范围 [${firstId} ~ ${lastId}]，继续滚动查找...`);
        // 目标ID小于当前范围的起始ID (正序) 或 大于 (倒序)，需要向上滚
        if ((!isReversed && id < firstId) || (isReversed && id > firstId)) {
          return Result.succeed(firstItem)
        }
        // 否则，向下滚
        return Result.succeed(lastItem)
      }),
    )
  }

  /**
   * 等待列表加载新内容。
   */
  async function waitForNewItemsToLoad() {
    // 最后的备选方案：短暂 sleep
    await sleep(LOAD_WAIT_MS)
  }

  let lastScrollTop = Number.NaN
  let retries = 0

  while (retries < maxRetries) {
    // 1. 在当前视图中查找
    const foundItem = await findItemInCurrentView(targetId)
    if (Result.isFailure(foundItem)) {
      return foundItem
    }
    if (foundItem.value) {
      return Result.succeed(foundItem.value)
    }

    // 1. 先找到目标点并滚动
    const scrollTarget = await determineScrollTarget(targetId)
    if (Result.isFailure(scrollTarget)) {
      return scrollTarget
    }
    await scrollTarget.value.scrollIntoViewIfNeeded({ timeout: 5000 })
    await waitForNewItemsToLoad()

    // 2. 获取当前的滚动位置
    const scrollContainer = await elementFinder.getGoodsItemsScrollContainer(page)
    if (Result.isFailure(scrollContainer)) {
      return scrollContainer
    }
    const currentScrollTop = await scrollContainer.value.evaluate(el => el.scrollTop)

    // 3. 检查是否滚动到底了 (终止条件)
    if (
      !Number.isNaN(lastScrollTop) &&
      Math.abs(lastScrollTop - currentScrollTop) <= SCROLL_TOLERANCE
    ) {
      // logger.debug(`滚动位置未改变，无法找到更多内容。ScrollTop: ${currentScrollTop}`);
      return Result.fail(
        new ElementNotFoundError({
          elementName: `id为${targetId}的商品`,
        }),
      )
    }
    lastScrollTop = currentScrollTop

    retries++
  }

  return Result.fail(
    new MaxTryCountExceededError({
      taskName: '查找商品',
      maxTryCount: maxRetries,
    }),
  )
}

/**
 * `toggleButton` 的观察者钩子（不改变行为，只用于让调用方区分两种成功）：
 * - `onAlreadyAtTarget`：进入时按钮**本来就已经**是目标态（没有发生点击）。
 * 为什么需要：自动讲解遇到「商品正在讲解」时应当**跳过**而不是先取消再重开，
 * 调用方需要一条可诊断的日志来说明「这一轮没有点击」，否则日志里只有「讲解成功」。
 */
export interface ToggleButtonHooks {
  onAlreadyAtTarget?: () => void
}

const TOGGLE_BUTTON_MAX_TRY_COUNT = 5
export async function toggleButton(
  button: ElementHandle<SVGElement | HTMLElement>,
  sourceContent: string,
  targetContent: string,
  signal?: AbortSignal,
  hooks?: ToggleButtonHooks,
  tryCount = 0,
): Result.ResultAsync<void, Error> {
  if (tryCount > TOGGLE_BUTTON_MAX_TRY_COUNT) {
    return Result.fail(
      new MaxTryCountExceededError({
        taskName: 'toggleButton',
        maxTryCount: TOGGLE_BUTTON_MAX_TRY_COUNT,
      }),
    )
  }
  const buttonText = (await button.textContent())?.trim() || ''
  if (buttonText !== sourceContent && buttonText !== targetContent) {
    return Result.fail(
      new ElementContentMismatchedError({
        current: buttonText,
        target: `${targetContent} 或 ${sourceContent}`,
      }),
    )
  }

  // 语义是「确保按钮处于目标状态」，不是字面意义的「翻转一次」：
  // 1. **已在目标状态**（商品正在讲解，按钮显示「取消讲解」）→ 直接成功、**不点击**。
  //    旧实现在 tryCount=0 时仍会点一次「取消讲解」，把正在讲解的商品先停掉再重开：
  //    运营侧看到一次无停顿的「取消→讲解」来回，且页面按钮态未稳定时第二次点击可能丢失
  //    （自动讲解本该「跳过本轮、进入下一轮」，而不是打断正在进行的讲解）。
  // 2. 处于源状态（「讲解」）→ 点击一次，等 1s 复查；仍未变成目标态就继续点，最多 5 次。
  if (buttonText === targetContent) {
    if (tryCount === 0) hooks?.onAlreadyAtTarget?.()
    return Result.succeed()
  }
  if (await button.isDisabled()) {
    return Result.fail(
      new ElementDisabledError({
        elementName: '讲解按钮',
        element: await button.evaluate(el => el.outerHTML),
      }),
    )
  }
  // button.click() 在抖店&百应的表现很诡异，所以用 dispatchEvent('click')
  await button.dispatchEvent('click')
  return Result.pipe(
    abortableSleep(1000, signal),
    Result.andThen(() =>
      toggleButton(button, sourceContent, targetContent, signal, hooks, tryCount + 1),
    ),
  )
}

/** 确保 page 非空 */
export function ensurePage(page: Page | null | undefined): Result.Result<Page, PlatformError> {
  if (!page) {
    return Result.fail(new PageNotFoundError())
  }
  return Result.succeed(page)
}

/** 通过 \<a\> 的点击打开新网页，主要是防止部分反爬的行为。
 *  调用方契约（douyin/buyin login 同款）：返回值**可能等于传入的 page**（fold 回退路径），
 *  关闭旧页前必须 `if (newPage !== page)` 判等——否则会把会话当前页关成死对象，后续 waitForSelector 必抛 Target closed。 */
export async function openUrlByElement(page: Page, url: string) {
  const context = page.context()
  // 壳模式（attach）兼容（Phase 2 更新）：业务弹窗默认开壳内新 Tab；登录/刷新等自动化窗口期
  // 由平台层显式 `session.setPopupMode('navigate')` 声明为同页折叠（此时 5s 内无 popup → 返回原页，
  // 与 launched popup 秒到行为区分）；调用方必须判等 `newPage !== page` 再决定是否关闭旧页。
  const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null)
  await page.evaluate(url => {
    const el = document.createElement('a')
    el.href = url
    el.target = '_blank'
    el.click()
  }, url)
  const popup = await popupPromise
  return popup ?? page
}
