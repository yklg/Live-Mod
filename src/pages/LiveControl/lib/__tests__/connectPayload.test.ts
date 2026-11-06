import { describe, expect, it } from 'vitest'
import { buildConnectPayload, type ConnectPayloadInput } from '../connectPayload'

const account: Account = { id: 'account-1', name: '测试账号' }

const baseInput: ConnectPayloadInput = {
  platform: 'douyin',
  account,
  headless: true,
  chromePath: '/Applications/Google Chrome.app',
  storageState: '/tmp/storage-state.json',
  uiStatus: false,
  forceExternal: false,
  shellMode: false,
}

// ===== mode 决策表（与 connectModePayload.test.ts TC-M1~M8 对齐）=====
// 核心守护：uiStatus 决定读哪个开关——两字段永不交叉生效；
// undefined = 不带 mode 键（而非 mode: undefined），交主进程裁决链（壳内默认层/矩阵）。
// 2(uiStatus) × 2(forceExternal) × 2(shellMode) 全组合。
const modeCases: Array<[boolean, boolean, boolean, 'attach' | 'launch' | undefined]> = [
  [true, true, false, 'launch'],
  [true, true, true, 'launch'],
  [true, false, false, undefined],
  [true, false, true, undefined],
  [false, false, false, undefined],
  [false, false, true, 'attach'],
  [false, true, false, undefined],
  [false, true, true, 'attach'],
]

describe('buildConnectPayload · mode 决策表全组合（TC-CP1~CP8）', () => {
  it.each(modeCases)(
    'uiStatus=%s × forceExternal=%s × shellMode=%s → mode=%s',
    (uiStatus, forceExternal, shellMode, expected) => {
      const payload = buildConnectPayload({ ...baseInput, uiStatus, forceExternal, shellMode })
      expect(payload.mode).toBe(expected)
    },
  )
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

  it('TC-CP10 决策 mode=undefined 时不带 mode 键（经典默认路径）', () => {
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

  it('TC-CP11 决策 mode=attach 时键存在且值为 attach（经典壳模式开关）', () => {
    const payload = buildConnectPayload({ ...baseInput, shellMode: true })
    expect(Object.hasOwn(payload, 'mode')).toBe(true)
    expect(payload.mode).toBe('attach')
  })

  it('TC-CP12 决策 mode=launch 时键存在且值为 launch（壳UI逃生口）', () => {
    const payload = buildConnectPayload({ ...baseInput, uiStatus: true, forceExternal: true })
    expect(Object.hasOwn(payload, 'mode')).toBe(true)
    expect(payload.mode).toBe('launch')
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
    const input: ConnectPayloadInput = {
      ...baseInput,
      uiStatus: true,
      forceExternal: true,
      shellMode: true,
    }
    const snapshot = structuredClone(input)
    buildConnectPayload(input)
    expect(input).toStrictEqual(snapshot)
  })

  it('TC-CP17 同输入两次调用结果一致', () => {
    const input: ConnectPayloadInput = { ...baseInput, shellMode: true }
    expect(buildConnectPayload(input)).toStrictEqual(buildConnectPayload(input))
  })
})
