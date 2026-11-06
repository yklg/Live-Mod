/**
 * 全局常量定义
 */

// 自动回复相关常量
export const AUTO_REPLY = {
  /** 最大评论数限制 */
  MAX_COMMENTS: 500,
  /** 最大回复数限制 */
  MAX_REPLIES: 500,
  /** 用户名占位符 */
  USERNAME_PLACEHOLDER: '{用户名}',
} as const

// Toast 提示相关常量
export const TOAST = {
  /** 同时显示的最大 toast 数量（经典模式 Toaster；壳模式走 NOTICE） */
  LIMIT: 1,
  /** toast 自动移除的延迟时间（毫秒） */
  REMOVE_DELAY: 3000,
} as const

/** 壳级通知层行为参数（shell-ui-polish v3 · D3 升级；经典模式不消费，保持 TOAST 原值） */
export const NOTICE = {
  /** 同时显示的最大通知数（超出淘汰最旧） */
  LIMIT: 3,
  /** 同 variant+description 去重窗口（毫秒） */
  DEDUPE_MS: 800,
  /** 自动消失时长（毫秒，按语义变体） */
  DURATION_MS: {
    success: 4000,
    info: 4000,
    warning: 5000,
    error: 6000,
  } satisfies Record<NoticeVariant, number>,
} as const

// 响应式断点常量
export const BREAKPOINTS = {
  /** 移动端断点（像素） */
  MOBILE: 768,
} as const
