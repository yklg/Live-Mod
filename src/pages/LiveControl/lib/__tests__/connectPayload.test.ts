import { describe, expect, it } from 'vitest'
import { buildConnectPayload, type ConnectPayloadInput } from '../connectPayload'

const account: Account = { id: 'account-1', name: '测试账号' }

const baseInput: ConnectPayloadInput = {
  platform: 'douyin',
  account,
  headless: true,
  chromePath: '/Applications/Google Chrome.app',
  storageState: '/tmp/storage-state.json',
  forceExternal: false,
}

// ===== mode 映射（经典模式移除后的口径）=====
// 壳 UI 是唯一运行形态：连接方式的唯一用户可见开关是「强制外部浏览器」逃生口；
// undefined = 不带 mode 键（而非 mode: undefined），交主进程裁决链（壳内默认层：抖音系默认 attach）。
describe('buildConnectPayload · mode 映射（TC-CP1~CP2）', () => {
  it.each([
    [false, undefined],
    [true, 'launch'],
  ] as const)('forceExternal=%s → mode=%s', (forceExternal, expected) => {
    const payload = buildConnectPayload({ ...baseInput, forceExternal })
    expect(payload.mode).toBe(expected)
  })
})

describe('buildConnectPayload · 字段透传与 mode 缺省键（TC-CP9~CP12）', () => {
  it('TC-CP9 平台/账号/headless/chromePath/storageState 原样透传', () => {
    const payload = buildConnectPayload({
      ...baseInput,
      platform: 'buyin',
      headless: false,
      chromePath: '/opt/chrome',
      storageState: '{"cookies":[]}',
    })
    expect(payload).toStrictEqual({
      headless: false,
      chromePath: '/opt/chrome',
      storageState: '{"cookies":[]}',
      platform: 'buyin',
      account,
    })
  })

  it('TC-CP10 逃生口关 → 不带 mode 键（交主进程默认层裁决）', () => {
    const payload = buildConnectPayload(baseInput)
    expect(Object.hasOwn(payload, 'mode')).toBe(false)
    expect(payload).toStrictEqual({
      headless: true,
      chromePath: '/Applications/Google Chrome.app',
      storageState: '/tmp/storage-state.json',
      platform: 'douyin',
      account,
    })
  })

  it('TC-CP11 逃生口开 → 键存在且值为 launch（显式外部浏览器）', () => {
    const payload = buildConnectPayload({ ...baseInput, forceExternal: true })
    expect(Object.hasOwn(payload, 'mode')).toBe(true)
    expect(payload.mode).toBe('launch')
  })

  it('TC-CP12 renderer 从不显式发 attach（壳内登录由主进程白名单默认层裁决）', () => {
    for (const forceExternal of [false, true]) {
      const payload = buildConnectPayload({ ...baseInput, forceExternal })
      expect(payload.mode).not.toBe('attach')
    }
  })
})

describe('buildConnectPayload · 淘宝强制关闭无头模式（TC-CP13~CP15）', () => {
  it('TC-CP13 淘宝 + 无头开 → 强制 false（人机验证需可见窗口）', () => {
    const payload = buildConnectPayload({ ...baseInput, platform: 'taobao', headless: true })
    expect(payload.headless).toBe(false)
  })

  it('TC-CP14 淘宝 + 无头关 → 保持 false', () => {
    const payload = buildConnectPayload({ ...baseInput, platform: 'taobao', headless: false })
    expect(payload.headless).toBe(false)
  })

  it('TC-CP15 非淘宝平台 + 无头开 → 不被改写（不误伤其它平台）', () => {
    for (const platform of ['douyin', 'buyin', 'eos', 'wxchannel'] as const) {
      const payload = buildConnectPayload({ ...baseInput, platform, headless: true })
      expect(payload.headless).toBe(true)
    }
  })
})

describe('buildConnectPayload · 纯性（TC-CP16~CP17）', () => {
  it('TC-CP16 不修改入参', () => {
    const input: ConnectPayloadInput = { ...baseInput, forceExternal: true }
    const snapshot = structuredClone(input)
    buildConnectPayload(input)
    expect(input).toStrictEqual(snapshot)
  })

  it('TC-CP17 同输入两次调用结果一致', () => {
    const input: ConnectPayloadInput = { ...baseInput, forceExternal: true }
    expect(buildConnectPayload(input)).toStrictEqual(buildConnectPayload(input))
  })
})
