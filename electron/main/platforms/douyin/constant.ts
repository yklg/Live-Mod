/** attach 壳内可信域名：登录/中控跨域时 fold 入壳内，不外开系统浏览器 */
export const OWNED_ORIGINS = ['jinritemai.com'] as const

export const URLS = {
  LIVE_CONTROL_PAGE: 'https://fxg.jinritemai.com/ffa/buyin/dashboard/live/control',
  LOGIN_PAGE:
    'https://fxg.jinritemai.com/login/common?extra=%7B%22target_url%22%3A%22https%3A%2F%2Ffxg.jinritemai.com%2Fffa%2Fbuyin%2Fdashboard%2Flive%2Fcontrol%22%7D',
  /** 抖店的电商罗盘主页 */
  DOUYIN_COMPASS_INDEX_PREFIX: 'https://compass.jinritemai.com/shop',
  /** 抖店电商大屏（主播版） */
  DOUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID:
    'https://compass.jinritemai.com/screen/anchor/shop?live_room_id=',
  /** 巨量百应的电商罗盘主页 */
  BUYIN_COMPASS_INDEX_PREFIX: 'https://compass.jinritemai.com/talent',
  /** 巨量百应电商大屏（主播版） */
  BUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID:
    'https://compass.jinritemai.com/screen/anchor/talent?live_room_id=',
} as const

export const REGEXPS = {
  LOGIN_PAGE: /.*fxg\.jinritemai\.com\/login\/common.*/,
}

/**
 * 中控台页面身份判据（IPlatform.isControlPageUrl 的数据源）：host 精确 + pathname 前缀。
 * 实际落点形如 `https://fxg.jinritemai.com/ffa/content-tool/live/control`
 * （旧版 `/ffa/buyin/dashboard/live/control` 同前缀）；登录页 `/login/*` 与罗盘等
 * 其它域均不满足 → 壳内导航漂移会被下播观测识别为「不可观测」而非「下播」。
 */
/**
 * 中控台页面身份判据（IPlatform.isControlPageUrl 的数据源）：host 精确 + 已知中控台路由白名单。
 * 禁止用 `/ffa/` 这类站点大前缀：同站业务页（/ffa/mshop/homepage、/ffa/g/list 等）会被误判为
 * 「仍在中控台」，页面漂移后仍按缺席判下播。现网落点 = content-tool 新版与 buyin dashboard 旧版。
 */
export const CONTROL_PAGE = {
  host: 'fxg.jinritemai.com',
  pathPrefixes: ['/ffa/buyin/dashboard/live/control', '/ffa/content-tool/live/control'],
} as const

export const SELECTORS = {
  LOGGED_IN: `[class^="index_userName"]`,
  IN_LIVE_CONTROL: `[class^="goodsPanel"]`,
  ACCOUNT_NAME: `[class^="index_userName"]`,

  GOODS_ITEM: 'div[class^="goodsItem"]',
  GOODS_ITEMS_WRAPPER: '#live-control-goods-list-container div',

  goodsItem: {
    ACTION: 'div[class^="goodsAction"]',
    POPUP_BUTTON: 'button',
    ID: 'div[class^="indexWrapper"] input',
  },
  commentInput: {
    TEXTAREA: '#input-comment-block-id textarea',
    SUBMIT_BUTTON: '#input-comment-block-id div[class^="inputSuffix"]',
    SUBMIT_BUTTON_DISABLED: 'isDisabled',
    /** 置顶的勾选框 */
    PIN_TOP_LABEL: '#input-comment-block-id label',
  },
  /** 注意：overlays 只供 liveStatusWatcher 的「直播总结」确定信号使用；
   *  不得在评论保活里每 3s 通用点击（AFK 选择器是任意 auxo 弹窗主按钮，会误触真实配置弹窗）。 */
  overlays: {
    /** 长时间不操作弹窗的关闭按钮（当前无运行时消费者；AFK 自动处理需真机确认专用选择器后接入） */
    AFK_CLOSE_BUTTON:
      'div.auxo-modal-content > div > div > div.auxo-modal-confirm-btns > button.auxo-btn.auxo-btn-primary',
    /** 直播结束后弹出的【直播总结】的关闭按钮 */
    LIVE_OVER_CLOSE_BUTTON: 'div.auxo-modal-content svg[class^="liveOverCloseIcon"]',
  },
  /** 有新的评论时会弹出的按钮，点击后刷新新评论 */
  NEW_COMMENT_LABEL: '[class^="newCommentLabel"]',
  /** 电商罗盘已登录状态 */
  COMPASS_LOGGED_IN: `div[class^="userName"]`,
  /** 【直播中】tag：抖店和百应都有，存在即正在直播（直播状态 watcher 的「直播中」信号） */
  LIVE_TAG: 'span[class^="liveTag"]',
} as const

export const TEXTS = {
  POPUP_BUTTON_CANCLE: '取消讲解',
  POPUP_BUTTON: '讲解',
} as const

/**
 * 【直播商品】
 */
// export const GOODS_ITEM_SELECTOR = `div[class^="goodsItem"]` as const
/**
 * 一个【直播商品】中的一系列【操作】按钮
 */
// export const GOODS_ACTION_SELECTOR = `div[class^="goodsAction"]` as const

// 抖店和百应都有一个【直播中】的tag，可以根据这个tag判断是否正在直播
// export const LIVE_TAG_SELECTOR = `span[class^="liveTag"]` as const

/**
 * 未直播时【直播互动】显示的信息
 */
// export const NO_LIVE_SELECTOR = `div[class^="noLiveData"]` as const

/**
 * 直播时【直播互动】下方的发送评论区域
 */
// export const COMMENT_BLOCK_SELECTOR = '#input-comment-block-id' as const
// export const COMMENT_TEXTAREA_SELECTOR =
//   `${COMMENT_BLOCK_SELECTOR} textarea` as const
// export const PIN_TOP_SELECTOR = `${COMMENT_BLOCK_SELECTOR} label` as const
// export const SUBMIT_COMMENT_SELECTOR = `${COMMENT_BLOCK_SELECTOR} div[class^="inputSuffix"]`

/**
 * 直播互动
 */
// export const COMMENT_LIST_WRAPPER = '#comment-list-wrapper'
// export const COMMENT_LIST_ITEM = `${COMMENT_LIST_WRAPPER} div[class^="commentItem"]`

/**
 * 恢复直播按钮
 */
// export const RECOVERY_BUTTON_SELECTOR =
//   'div.auxo-modal-content > div > div > div.auxo-modal-confirm-btns > button.auxo-btn.auxo-btn-primary'

/**
 * 直播结束后弹出的【直播总结】的关闭按钮
 */
// export const LIVE_OVER_CLOSE_SELECTOR =
//   'div.auxo-modal-content svg[class^="liveOverCloseIcon"]'
