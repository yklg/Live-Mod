import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultEnvMatrix,
  resolveConnectMode,
  SHELL_DEFAULT_ATTACH_PLATFORMS,
} from '#/platforms/envMatrix'
import { createRuntimeEnvState } from '#/platforms/runtimeEnvState'

// ===== mode 裁决决策表（A3：消费点唯一）+ 静态/运行时两层分离（A2）=====
// 优先级链：payload.mode ?? (degraded ? 'launch' : envMatrix[platform] ?? 'launch')
// 守护不变量：
//   I9 显式 payload 永远赢（含 degraded 时人工指定 attach）
//   I10 degraded 只影响裁决，永不回写静态矩阵
//   I11 TTL 过期自动失效，下次连接重探
//   I12 stealthOff 标记不改变 mode

const matrix = { douyin: 'attach', taobao: 'launch' } as const

describe('resolveConnectMode 决策表（TC-U4）', () => {
  const cases: Array<[string, Parameters<typeof resolveConnectMode>[0], 'attach' | 'launch']> = [
    [
      'payload=attach × degraded × matrix=attach',
      { payloadMode: 'attach', platform: 'douyin', degraded: true, matrix },
      'attach',
    ],
    [
      'payload=attach × 无degraded × matrix=launch',
      { payloadMode: 'attach', platform: 'taobao', degraded: false, matrix },
      'attach',
    ],
    [
      'payload=launch × degraded × matrix=attach',
      { payloadMode: 'launch', platform: 'douyin', degraded: true, matrix },
      'launch',
    ],
    [
      '无payload × degraded × matrix=attach → 降级',
      { platform: 'douyin', degraded: true, matrix },
      'launch',
    ],
    [
      '无payload × 无degraded × matrix=attach',
      { platform: 'douyin', degraded: false, matrix },
      'attach',
    ],
    [
      '无payload × 无degraded × matrix=launch',
      { platform: 'taobao', degraded: false, matrix },
      'launch',
    ],
    [
      '无payload × matrix 无此平台 → 默认 launch',
      { platform: 'kuaishou', degraded: false, matrix },
      'launch',
    ],
    [
      'degraded × matrix 无此平台 → launch',
      { platform: 'kuaishou', degraded: true, matrix },
      'launch',
    ],
  ]
  for (const [name, input, expected] of cases) {
    it(`TC-U4 [${name}] → ${expected}`, () => {
      expect(resolveConnectMode(input)).toBe(expected)
    })
  }
})

// ===== 壳内默认层（shell-in-browser-login-default-attach v3 + shell-entry-platform-selector v1）=====
// 优先级：payload ?? (shellUi && 白名单 ? attach（degraded 期除外） : 原链)
describe('resolveConnectMode 壳 UI 默认层（TC-S1~S9）', () => {
  it('TC-S1 [白名单固化] 抖音系三平台 = douyin + buyin + eos', () => {
    expect([...SHELL_DEFAULT_ATTACH_PLATFORMS].sort()).toEqual(['buyin', 'douyin', 'eos'])
  })
  it('TC-S2 [shellUi + douyin + 无 payload] → attach（压过矩阵 launch）', () => {
    expect(
      resolveConnectMode({
        platform: 'douyin',
        degraded: false,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S3 [shellUi + buyin] → attach', () => {
    expect(
      resolveConnectMode({
        platform: 'buyin',
        degraded: false,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S4 [shellUi + 非白名单 kuaishou] → 矩阵裁决不变', () => {
    expect(
      resolveConnectMode({
        platform: 'kuaishou',
        degraded: false,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('launch')
  })
  it('TC-S5 [shellUi + 白名单 + degraded] → launch（降级期回外部，TTL 后自动回壳内）', () => {
    expect(
      resolveConnectMode({
        platform: 'douyin',
        degraded: true,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('launch')
  })
  it('TC-S6 [逃生口 payload=launch 赢过壳内默认层]', () => {
    expect(
      resolveConnectMode({
        payloadMode: 'launch',
        platform: 'douyin',
        degraded: false,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('launch')
  })
  it('TC-S7 [shellUi=false 经典逐键不变]', () => {
    for (const platform of ['douyin', 'buyin', 'kuaishou']) {
      expect(resolveConnectMode({ platform, degraded: false, matrix: defaultEnvMatrix })).toBe(
        defaultEnvMatrix[platform as keyof typeof defaultEnvMatrix] ?? 'launch',
      )
    }
  })

  // eos（抖音团购）纳入白名单依据：douyin-eos/login 优先 goto 登录页、无弹窗回退路径（attach 安全）
  it('TC-S8 [shellUi + eos] → attach（抖音团购同链路，压过矩阵 launch）', () => {
    expect(
      resolveConnectMode({
        platform: 'eos',
        degraded: false,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S9 [shellUi + eos + degraded] → launch（降级期回外部，TTL 后自动回壳内）', () => {
    expect(
      resolveConnectMode({
        platform: 'eos',
        degraded: true,
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('launch')
  })
})

describe('runtimeEnvState（TC-U5 ~ TC-U6, TC-U13）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('TC-U5 [不回写] degrade 后静态矩阵逐键不变', () => {
    const snapshot = { ...matrix }
    const state = createRuntimeEnvState({ ttlMs: 60000 })
    state.degrade('douyin')
    expect(matrix).toEqual(snapshot)
    expect(
      resolveConnectMode({ platform: 'douyin', degraded: state.isDegraded('douyin'), matrix }),
    ).toBe('launch')
  })

  it('TC-U6 [TTL] 过期后裁决恢复矩阵默认，且可重探', () => {
    const state = createRuntimeEnvState({ ttlMs: 60000 })
    state.degrade('douyin')
    vi.advanceTimersByTime(60001)
    expect(state.isDegraded('douyin')).toBe(false)
    expect(
      resolveConnectMode({ platform: 'douyin', degraded: state.isDegraded('douyin'), matrix }),
    ).toBe('attach')
  })

  it('TC-U6b [显式清除] clear 立即失效', () => {
    const state = createRuntimeEnvState({ ttlMs: 60000 })
    state.degrade('douyin')
    state.clear('douyin')
    expect(state.isDegraded('douyin')).toBe(false)
  })

  it('TC-U13 [F4] markStealthOff 记录标记且不影响 mode', () => {
    const state = createRuntimeEnvState({ ttlMs: 60000 })
    state.markStealthOff('douyin')
    expect(state.isStealthOff('douyin')).toBe(true)
    expect(
      resolveConnectMode({ platform: 'douyin', degraded: state.isDegraded('douyin'), matrix }),
    ).toBe('attach')
  })
})
