declare type Account = {
  readonly id: string
  name: string
}

declare interface ProviderInfo {
  name: string
  baseURL: string
  apiUrl: string
  models: string[]
}

declare type LiveControlPlatform =
  | 'douyin'
  | 'buyin'
  | 'eos'
  | 'xiaohongshu'
  | 'pgy'
  | 'wxchannel'
  | 'kuaishou'
  | 'taobao'
  | 'dev'

declare type GoodsItem = {
  id: number
  /** 单品循环弹窗次数，默认 1 */
  repeatCount?: number
  /** 单品弹窗间隔 [min, max] 毫秒，不设则用全局间隔 */
  itemInterval?: [number, number]
}

declare type AutoPopupConfig = {
  scheduler: {
    interval: [number, number]
  }
  goodsIds: number[]
  goodsItems?: GoodsItem[]
  random?: boolean
}

declare type AutoPopupTask = {
  type: 'auto-popup'
  config: AutoPopupConfig
}

declare type AutoCommentConfig = {
  scheduler: {
    interval: [number, number]
  }
  messages: {
    content: string
    pinTop: boolean
  }[]
  random?: boolean
  extraSpaces?: boolean
  unlimitedLength?: boolean
}

declare type AutoCommentTask = {
  type: 'auto-comment'
  config: AutoCommentConfig
}

declare type SendBatchMessagesConfig = {
  messages: string[]
  count: number
  noSpace?: boolean
}

declare type SendBatchMessagesTask = {
  type: 'send-batch-messages'
  config: SendBatchMessagesConfig
}

declare interface CommentListenerConfig {
  source: 'compass' | 'control' | 'wechat-channel' | 'xiaohongshu' | 'taobao' | 'kuaishou'
  ws?: {
    port: number
  }
}

declare type CommentListenerTask = {
  type: 'comment-listener'
  config: CommentListenerConfig
}

declare type PinCommentTask = {
  type: 'pin-comment'
  config: {
    comment: string
  }
}

declare type LiveControlTask =
  | AutoPopupTask
  | AutoCommentTask
  | SendBatchMessagesTask
  | CommentListenerTask
  | PinCommentTask

declare type DouyinLiveMessage = {
  time: number
} & (
  | CommentMessage
  | RoomEnterMessage
  | RoomLikeMessage
  | LiveOrderMessage
  | SubscribeMerchantBrandVipMessage
  | RoomFollowMessage
  | EcomFansclubParticipateMessage
)

interface CommentMessage {
  msg_type: 'comment'
  msg_id: string
  nick_name: string
  content: string
}

interface RoomEnterMessage {
  msg_type: 'room_enter'
  msg_id: string
  nick_name: string
  user_id: string
}

interface RoomLikeMessage {
  msg_type: 'room_like'
  msg_id: string
  nick_name: string
  user_id: string
}

interface SubscribeMerchantBrandVipMessage {
  msg_type: 'subscribe_merchant_brand_vip'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
}

interface RoomFollowMessage {
  msg_type: 'room_follow'
  msg_id: string
  nick_name: string
  user_id: string
}

interface EcomFansclubParticipateMessage {
  msg_type: 'ecom_fansclub_participate'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
}

interface LiveOrderMessage {
  msg_type: 'live_order'
  nick_name: string
  msg_id: string
  order_status: '已下单' | '已付款' | '未知状态'
  order_ts: number
  product_id: string
  product_title: string
}

declare type WechatChannelLiveMessage = {
  msg_type: 'wechat_channel_live_msg'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: number
}

declare type XiaohongshuCommentLiveMessage = {
  msg_type: 'xiaohongshu_comment'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: number
}

declare type TaobaoCommentLiveMessage = {
  msg_type: 'taobao_comment'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: number
}

declare type LiveMessage =
  | WechatChannelLiveMessage
  | DouyinLiveMessage
  | XiaohongshuCommentLiveMessage
  | TaobaoCommentLiveMessage

/** 壳入口平台目录条目（壳入口选择器唯一数据源，由主进程 catalog 下发；renderer 只读） */
declare type ShellPlatformEntry = {
  id: LiveControlPlatform
  label: string
  description: string
  category: 'douyin' | 'other'
  attachSupported: boolean
  /** 本地官方图标标识：对应 public/platform-icons/{icon}.png */
  icon: string
}

/** 壳入口目录快照（含记忆态，供选择器渲染「记住选择」开关） */
declare type ShellEntryCatalog = {
  platforms: ShellPlatformEntry[]
  remembered: {
    platform: LiveControlPlatform | null
    autoRestore: boolean
  }
}

/** 壳入口视图名（viewHost 以 --lm-view=<name> 注入 renderer argv，preload 同步暴露） */
declare type ShellViewName =
  | 'index'
  | 'chrome'
  | 'rail'
  | 'workspace'
  | 'entry'
  | 'notice'
  | 'drag'
  | 'assistant'

/** 通知语义变体（壳级通知层；经典模式不消费） */
declare type NoticeVariant = 'success' | 'error' | 'warning' | 'info'

/** 壳级通知 payload（renderer -> main / main -> notice 渲染层；字符串可序列化，禁 ReactNode） */
declare type NoticePayload = {
  variant: NoticeVariant
  title?: string
  description: string
}

declare interface Window {
  /** preload 同步注入：当前视图名 + 是否壳 UI（替代异步 uiStatus，消除启动竞态） */
  __lmView?: { name: ShellViewName; shellUi: boolean }
  /** 仅测试口径：通知停留时长覆盖（LM_SHELL_NOTICE_TEST_MS，preload 从 argv 读取） */
  __lmNoticeTestMs?: number
  /** 调试用评论注入（主进程仅在 LM_SHELL_DEBUG=1 注册；面板据 getState().debug 决定是否显示入口） */
  __lmCommentDebug?: {
    inject: (text: string) => Promise<{ ok: boolean; accountId?: string; error?: string }>
  }
}
