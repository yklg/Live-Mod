import { SELECTORS as DY_SELECTORS } from '../douyin/constant'

/** attach 壳内可信域名：百应登录链路会跨到 douyinec.com，必须 fold 入壳内（真实缺陷回归点） */
export const OWNED_ORIGINS = ['jinritemai.com', 'douyinec.com'] as const

export const URLS = {
  LIVE_CONTROL_PAGE: 'https://buyin.jinritemai.com/dashboard/live/control',
  LOGIN_PAGE: 'https://buyin.jinritemai.com/mpa/account/login?log_out=1&type=24',
  /** 百应的电商罗盘主页 */
  COMPASS_INDEX: 'https://compass.jinritemai.com/talent',
  COMPASS_SCREEN_WITH_LIVE_ROOM_ID:
    'https://compass.jinritemai.com/screen/anchor/talent?live_room_id=',
} as const

export const REGEXPS = {
  LOGIN_PAGE: /douyinec\.com/,
}

/**
 * 中控台页面身份判据（IPlatform.isControlPageUrl 的数据源）：host 精确 + pathname 前缀。
 * 中控台落点 `https://buyin.jinritemai.com/dashboard/live/control`；
 * 登录页在 `/mpa/account/login`、跨域登录在 douyinec.com，均不满足 → 漂流可被观测。
 */
/** 百应中控台页面身份判据：host 精确 + 已知中控台路由白名单（不用 /dashboard/ 大前缀） */
export const CONTROL_PAGE = {
  host: 'buyin.jinritemai.com',
  pathPrefixes: ['/dashboard/live/control'],
} as const

export const SELECTORS = {
  ...DY_SELECTORS,
  LOGGED_IN: '[class^="header"]',
  IN_LIVE_CONTROL: '[class^="goodsPanel"]',
  ACCOUNT_NAME: 'span.btn-item-role-exchange-name__title',
} as const
