import { describe, expect, it } from 'vitest'
import { buildConnectPayload, type ConnectPayloadInput } from '../connectPayload'

const account: Account = { id: 'account-1', name: '测试账号' }

const baseInput: ConnectPayloadInput = {
  platform: 'douyin',
  account,
  headless: true,
  chromePath: '/Applications/Google Chrome.app',
  storageState: '/tmp/storage-state.json',
}

// ===== mode 映射（经典模式移除后的口径）=====
// 壳 v3 · Wave 1：「强制外部浏览器」逃生口已删除（TC-CP1/CP2 随之下线）。
// 渲染层不再产出 mode，形态一律交主进程裁决链：
// payload.mode ?? (壳 UI 开启且平台在白名单 → attach) ?? 静态矩阵 ?? 'launch'。
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

  it('TC-CP10 渲染层永不带 mode 键（交主进程默认层裁决）', () => {
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
    const input: ConnectPayloadInput = { ...baseInput }
    const snapshot = structuredClone(input)
    buildConnectPayload(input)
    expect(input).toStrictEqual(snapshot)
  })

  it('TC-CP17 同输入两次调用结果一致', () => {
    const input: ConnectPayloadInput = { ...baseInput }
    expect(buildConnectPayload(input)).toStrictEqual(buildConnectPayload(input))
  })
})
