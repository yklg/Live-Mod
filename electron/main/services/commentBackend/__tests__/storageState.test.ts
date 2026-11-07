import { describe, expect, it } from 'vitest'
import {
  buildStorageState,
  isLoginUrl,
  toPlaywrightCookies,
} from '#/services/commentBackend/storageState'

describe('storageState / isLoginUrl（TC-CB14~CB16）', () => {
  it('TC-CB14 buildStorageState：cookies 透传 + 按 consoleUrl 源生成 localStorage', () => {
    const raw = JSON.parse(
      buildStorageState(
        { cookies: [{ name: 'ttwid', value: 'v1' }], localStorage: { a: '1', b: '2' } },
        'https://fxg.jinritemai.com/ffa/content-tool/live/control',
      ),
    )
    expect(raw.cookies).toEqual([
      {
        name: 'ttwid',
        value: 'v1',
        domain: undefined,
        path: '/',
        secure: false,
        httpOnly: false,
        expires: -1,
      },
    ])
    expect(raw.origins).toEqual([
      {
        origin: 'https://fxg.jinritemai.com',
        localStorage: [
          { name: 'a', value: '1' },
          { name: 'b', value: '2' },
        ],
      },
    ])
  })

  it('TC-CB15 cookie 字段映射：sameSite 规范化/持久 cookie 带 expires/无效项丢弃', () => {
    const mapped = toPlaywrightCookies([
      { name: 'a', value: '1', sameSite: 'lax', expirationDate: 123, secure: true, httpOnly: true },
      { name: 'b', value: '2', sameSite: 'none' },
      { name: 'bad' },
      null,
    ])
    expect(mapped[0]).toMatchObject({ sameSite: 'Lax', expires: 123, secure: true, httpOnly: true })
    expect(mapped[1].expires).toBe(-1)
    expect(mapped).toHaveLength(2)
  })

  it('TC-CB16 isLoginUrl：登录/SSO 命中，中控台不命中', () => {
    expect(isLoginUrl('https://buyin.jinritemai.com/mpa/account/login?x=1')).toBe(true)
    expect(isLoginUrl('https://passport.douyin.com/x')).toBe(true)
    expect(isLoginUrl('https://buyin-sso.jinritemai.com/check')).toBe(true)
    expect(isLoginUrl('https://fxg.jinritemai.com/ffa/content-tool/live/control')).toBe(false)
  })
})
