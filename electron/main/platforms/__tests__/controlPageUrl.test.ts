import { describe, expect, it, vi } from 'vitest'

// ===== IPlatform.isControlPageUrl 平台契约（A2：会话页身份判据）=====
// 为什么测平台类而不是只测纯函数：该方法消费方（AccountSession 导航告警 / liveStatusWatcher
// 身份观测）是按「可选能力」探测的——平台忘了实现不会编译报错，只会静默不观测。
// 这里锁死三个 attach 平台都必须实现，且**只认已知中控台路由白名单**：
// 同站业务页（/ffa/mshop/homepage、/ffa/g/list、/dashboard/* 等）漂移后必须判 false，
// 否则「页面已离开中控台」仍会被当作可观测 → 缺席判据继续 3×5s 误判下播（症状③残余）。
// 平台类 import 链会拉 logger/utils（含 electron 依赖），测试只需 URL 判定，故 mock 掉。
vi.mock('#/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    scope: vi.fn(),
  }),
}))
vi.mock('#/utils', () => ({ sleep: vi.fn(), abortableSleep: vi.fn() }))

import { BuyinPlatform } from '../buyin'
import { CONTROL_PAGE as BUYIN_CONTROL_PAGE } from '../buyin/constant'
import { DouyinPlatform } from '../douyin'
import { CONTROL_PAGE as DOUYIN_CONTROL_PAGE } from '../douyin/constant'
import { DouyinEosPlatform } from '../douyin-eos'
import { CONTROL_PAGE as EOS_CONTROL_PAGE } from '../douyin-eos/constant'
import { isControlPageUrlIn } from '../IPlatform'

describe('IPlatform.isControlPageUrl（平台中控台身份判据 / A2）', () => {
  it('TC-P1 [抖店] 已知中控台路由为真；同站业务页/登录页/罗盘/异域/非法 URL 为假', () => {
    const platform = new DouyinPlatform()
    expect(typeof platform.isControlPageUrl, '抖店必须实现 isControlPageUrl').toBe('function')
    // 现网落点与旧路径（都是中控台）
    expect(
      platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/content-tool/live/control'),
    ).toBe(true)
    expect(
      platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/buyin/dashboard/live/control?a=1'),
    ).toBe(true)
    // 中控台子路由/参数：前缀命中
    expect(
      platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/content-tool/live/control/room/1'),
    ).toBe(true)
    // 登录页（/login）不算中控台
    expect(
      platform.isControlPageUrl(
        'https://fxg.jinritemai.com/login/common?extra=%7B%22target_url%22%3A%22x%22%7D',
      ),
    ).toBe(false)
    // **同站业务页不算**（收窄判据的核心回归：SPA/菜单漂移不能继续「可观测」）
    expect(platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/mshop/homepage')).toBe(false)
    expect(platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/g/list')).toBe(false)
    expect(platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/buyin/dashboard/order')).toBe(
      false,
    )
    // 罗盘（异 host）与同路径异域均不算
    expect(platform.isControlPageUrl('https://compass.jinritemai.com/shop')).toBe(false)
    expect(
      platform.isControlPageUrl('https://evil.example.com/ffa/content-tool/live/control'),
    ).toBe(false)
    // 非法 URL / 空 URL 归约为 false，禁止裸抛
    expect(platform.isControlPageUrl('not a url')).toBe(false)
    expect(platform.isControlPageUrl('')).toBe(false)
    expect(platform.isControlPageUrl('about:blank')).toBe(false)
  })

  it('TC-P2 [百应] 中控台 /dashboard/live/control 为真；/dashboard/* 业务页与跨域登录为假', () => {
    const platform = new BuyinPlatform()
    expect(typeof platform.isControlPageUrl, '百应必须实现 isControlPageUrl').toBe('function')
    expect(platform.isControlPageUrl('https://buyin.jinritemai.com/dashboard/live/control')).toBe(
      true,
    )
    expect(
      platform.isControlPageUrl('https://buyin.jinritemai.com/dashboard/live/control?room=1'),
    ).toBe(true)
    // 同站其它 dashboard 业务页不算中控台
    expect(platform.isControlPageUrl('https://buyin.jinritemai.com/dashboard/daren/list')).toBe(
      false,
    )
    expect(platform.isControlPageUrl('https://buyin.jinritemai.com/dashboard')).toBe(false)
    expect(
      platform.isControlPageUrl('https://buyin.jinritemai.com/mpa/account/login?log_out=1&type=24'),
    ).toBe(false)
    // 百应登录可能跨到 douyinec.com（ownedOrigins 之一），同样不是中控台
    expect(platform.isControlPageUrl('https://login.douyinec.com/passport/login')).toBe(false)
    expect(platform.isControlPageUrl('https://fxg.jinritemai.com/ffa/x')).toBe(false)
  })

  it('TC-P3 [抖音团购] 已知中控台路由为真；登录页/业务页为假（无 watcher 也须实现契约）', () => {
    const platform = new DouyinEosPlatform()
    expect(typeof platform.isControlPageUrl, '团购必须实现 isControlPageUrl').toBe('function')
    expect(platform.isControlPageUrl('https://eos.douyin.com/livesite/live/current')).toBe(true)
    expect(platform.isControlPageUrl('https://eos.douyin.com/livesite/live/current?x=1')).toBe(true)
    expect(platform.isControlPageUrl('https://eos.douyin.com/livesite/login')).toBe(false)
    expect(platform.isControlPageUrl('https://eos.douyin.com/livesite/goods')).toBe(false)
    expect(platform.isControlPageUrl('https://eos.douyin.com/livesite/live/other')).toBe(false)
    expect(platform.isControlPageUrl('https://eos.douyin.com/')).toBe(false)
  })

  it('TC-P4 [纯函数边界] 路径归一化（../ 绕过）与未知路由归 false', () => {
    // new URL 会归一化 /ffa/buyin/dashboard/live/control/../../login → /ffa/buyin/login，不命中
    expect(
      isControlPageUrlIn(
        'https://fxg.jinritemai.com/ffa/content-tool/live/control/../../../../login/common',
        DOUYIN_CONTROL_PAGE,
      ),
    ).toBe(false)
    expect(
      isControlPageUrlIn(
        'https://fxg.jinritemai.com/ffa/content-tool/live/control',
        DOUYIN_CONTROL_PAGE,
      ),
    ).toBe(true)
    expect(
      isControlPageUrlIn('https://buyin.jinritemai.com/dashboard/live/control', BUYIN_CONTROL_PAGE),
    ).toBe(true)
    expect(
      isControlPageUrlIn('https://eos.douyin.com/livesite/live/current', EOS_CONTROL_PAGE),
    ).toBe(true)
    // 非法输入永远 false（不裸抛）
    expect(isControlPageUrlIn(':::', EOS_CONTROL_PAGE)).toBe(false)
  })
})
