/** attach 壳内可信域名（eos 登录/中控均在 douyin.com 域下） */
export const OWNED_ORIGINS = ['douyin.com'] as const

export const URLS = {
  LIVE_CONTROL: 'https://eos.douyin.com/livesite/live/current',
  LOGIN_PAGE: 'https://eos.douyin.com/livesite/login',
} as const

export const REGEXPS = {
  LOGIN_PAGE: /.*eos\.douyin\.com\/livesite\/login.*/,
}

/**
 * 中控台页面身份判据（IPlatform.isControlPageUrl 的数据源）：host 精确 + pathname 前缀。
 * 中控台落点 `https://eos.douyin.com/livesite/live/current`；登录页 `/livesite/login`
 * 不满足 → 登录跳转不会被误认作中控台。
 */
/** eos 中控台页面身份判据：host 精确 + 已知中控台路由白名单（登录页 /livesite/login 不命中） */
export const CONTROL_PAGE = {
  host: 'eos.douyin.com',
  pathPrefixes: ['/livesite/live/current'],
} as const

export const SELECTORS = {
  LOGGED_IN: `[class^="head-container"]`,
  IN_LIVE_CONTROL: `[class^="layout-container"]`,
  ACCOUNT_NAME: `[class^="profile-container"]`,

  GOODS_ITEM: '#live-card-list div[class^="render-item"]',
  GOODS_ITEMS_WRAPPER: '#live-card-list > div > div',
  commentInput: {
    TEXTAREA: 'textarea[class^="input"]',
    SUBMIT_BUTTON: 'div[class^="comment-wrap"] div[class^="button"]',
  },
  goodsItem: {
    POPUP_BUTTON: '[class^="talking-btn"]',
    ID: 'input',
  },
} as const

export const TEXTS = {
  POPUP_BUTTON: '讲解',
  POPUP_BUTTON_CANCLE: '取消讲解',
} as const
