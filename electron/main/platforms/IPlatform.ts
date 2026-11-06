import type { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import type { PlatformError } from '#/errors/PlatformError'
import type { BrowserSession } from '#/managers/BrowserSessionManager'

export interface ICommentListener {
  _isCommentListener: true
  startCommentListener(
    onComment: (comment: LiveMessage) => void,
    /** 暂定，control 为中控台互动评论监听， compass 为直播大屏监听 */
    source: CommentListenerConfig['source'],
  ): void | Promise<void>
  stopCommentListener(): void
  getCommentListenerPage(): Page
}

export function isCommentListener(platform: IPlatform): platform is IPlatform & ICommentListener {
  return '_isCommentListener' in platform && platform._isCommentListener === true
}

export interface IPerformPopup {
  _isPerformPopup: true
  /** 弹窗指定商品序号 */
  performPopup(id: number, signal?: AbortSignal): Result.ResultAsync<void, Error>
  /** 获取弹窗任务所需的页面 */
  getPopupPage(): Page | null
}

export function isPerformPopup(platform: IPlatform): platform is IPlatform & IPerformPopup {
  return '_isPerformPopup' in platform && platform._isPerformPopup === true
}

export interface IPerformComment {
  _isPerformComment: true
  /** 在互动评论区域发送评论，返回结果表示是否成功置顶 */
  performComment(message: string, pinTop?: boolean): Result.ResultAsync<boolean, PlatformError>
  /** 获取评论任务所需的页面 */
  getCommentPage(): Page | null
}

export function isPerformComment(platform: IPlatform): platform is IPlatform & IPerformComment {
  return '_isPerformComment' in platform && platform._isPerformComment === true
}

export interface IPinComment {
  _isPinComment: true
  /** 置顶评论 */
  pinComment(comment: string, signal?: AbortSignal): Result.ResultAsync<void, PlatformError>
  /** 获取置顶评论任务所需的页面 */
  getPinCommentPage(): Page | null
}

export function isPinComment(platform: IPlatform): platform is IPlatform & IPinComment {
  return '_isPinComment' in platform && platform._isPinComment === true
}

export interface ISendRedPacket {
  _isSendRedPacket: true
  /** 一键发红包：点击发红包按钮，选择店铺红包，投放已有红包，选择限时领取时长 */
  sendRedPacket(duration: string, signal?: AbortSignal): Result.ResultAsync<void, PlatformError>
  getRedPacketPage(): Page | null
}

export function isSendRedPacket(platform: IPlatform): platform is IPlatform & ISendRedPacket {
  return '_isSendRedPacket' in platform && platform._isSendRedPacket === true
}

export interface ILiveStatusWatcher {
  _isLiveStatusWatcher: true
  /** 监听直播状态，确认真实下播（非暂停）时触发一次 onLiveEnd */
  startLiveStatusWatch(onLiveEnd: () => void): void
  stopLiveStatusWatch(): void
}

export function isLiveStatusWatcher(
  platform: IPlatform,
): platform is IPlatform & ILiveStatusWatcher {
  return '_isLiveStatusWatcher' in platform && platform._isLiveStatusWatcher === true
}

/**
 * 中控台页面身份判据（`IPlatform.isControlPageUrl` 的配套纯函数）：
 * 精确 host + pathname 前缀匹配。任何无法解析的 URL 都归约为 false（禁止裸抛）。
 *
 * 为什么放在契约模块：host/路径前缀这类**平台域名知识必须留在各平台 constant.ts**（A5 边界），
 * 但「URL 解析 + 异常归约」是三个平台共用的纯逻辑，放这里避免三份 try/catch 演化出差异。
 */
/** 中控台页面身份判据的数据源（平台层 constant 提供；A5：域名/路由知识归平台层） */
export interface ControlPagePattern {
  host: string
  /** 已知中控台路由前缀白名单（禁止用站点大前缀：同站业务页漂移会被误判为「仍在中控台」） */
  pathPrefixes: readonly string[]
}

export function isControlPageUrlIn(url: string, pattern: ControlPagePattern): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname === pattern.host &&
      pattern.pathPrefixes.some(prefix => parsed.pathname.startsWith(prefix))
    )
  } catch {
    return false
  }
}

export interface IPlatform {
  get platformName(): string
  /** 本平台登录/中控链路可信域名后缀（attach 壳内跨域 fold 白名单；A5：域名知识归平台层） */
  readonly ownedOrigins?: readonly string[]
  /**
   * 当前 URL 是否仍在中控台（下播判定与导航告警的页面身份判据）。
   * 返回 false = 页面已漂移出中控台（登录页/业务中转页/罗盘等），调用方应视为「不可观测」而不是「下播」。
   * 平台未实现 → 调用方跳过观测（行为与改造前一致）。
   */
  isControlPageUrl?(url: string): boolean
  /** 连接到中控台，最终停留在中控台页面 */
  connect(browserSession: BrowserSession): Promise<boolean>
  /** 登录 */
  login(browserSession: BrowserSession): Promise<void>
  /** 在中控台页面获取用户名 */
  getAccountName(session: BrowserSession): Promise<string>

  disconnect(): Promise<void>
}
