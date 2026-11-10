import { describe, expect, it } from 'vitest'
import {
  defaultEnvMatrix,
  resolveConnectMode,
  SHELL_DEFAULT_ATTACH_PLATFORMS,
} from '#/platforms/envMatrix'
import { createRuntimeEnvState } from '#/platforms/runtimeEnvState'

// ===== mode 裁决决策表（消费点唯一）+ 静态矩阵层（壳 v3 · Wave 1）=====
// 优先级链：payload.mode ?? (shellUi && 白名单平台 ? 'attach' : envMatrix[platform] ?? 'launch')
// 守护不变量：
//   I9  显式 payload 永远赢（人工指定 attach 也赢）
//   I10 裁决纯函数不写任何外部状态（静态矩阵逐键不变）
//   I11 stealthOff 标记不改变 mode
//   I12 **不存在 degraded 入参**——降级层已整体下线（计划 §3.3）
//        「attach 失败就换外部浏览器」是"为什么还会出现回退降级"的根因，已删除。
//
// 壳 v3 · Wave 1 同步点（计划 §3.3 要求「断言 + 文件头优先级链注释 + docstring 三处同批」）：
// 下面三条同源改写，缺一处就会让文档与行为再次漂移。

const matrix = { douyin: 'attach', taobao: 'launch' } as const

describe('resolveConnectMode 决策表（TC-U4）', () => {
  const cases: Array<[string, Parameters<typeof resolveConnectMode>[0], 'attach' | 'launch']> = [
    [
      'payload=attach × matrix=attach',
      { payloadMode: 'attach', platform: 'douyin', matrix },
      'attach',
    ],
    [
      'payload=attach × matrix=launch（显式赢矩阵）',
      { payloadMode: 'attach', platform: 'taobao', matrix },
      'attach',
    ],
    [
      'payload=launch × matrix=attach（显式赢矩阵）',
      { payloadMode: 'launch', platform: 'douyin', matrix },
      'launch',
    ],
    [
      '无payload × matrix=attach',
      { platform: 'douyin', matrix },
      'attach',
    ],
    [
      '无payload × matrix=launch',
      { platform: 'taobao', matrix },
      'launch',
    ],
    [
      '无payload × matrix 无此平台 → 默认 launch',
      { platform: 'kuaishou', matrix },
      'launch',
    ],
    [
      'shellUi 关闭 × matrix=attach → 仍走矩阵（壳内默认层不生效）',
      { platform: 'douyin', matrix, shellUiEnabled: false },
      'attach',
    ],
  ]
  for (const [name, input, expected] of cases) {
    it(`TC-U4 [${name}] → ${expected}`, () => {
      expect(resolveConnectMode(input)).toBe(expected)
    })
  }

  it('TC-U4-neg [无 degraded 入参] 裁决输入不接受降级开关', () => {
    // 降级层已删除：入参里再出现 degraded 只会是调用方漏改，必须在类型层就红。
    // （TS 层面已由 ConnectModeInput 约束；这里补运行时护栏：多余键不影响裁决）
    expect(
      resolveConnectMode({
        platform: 'douyin',
        matrix,
        ...({ degraded: true } as Record<string, unknown>),
      }),
    ).toBe('attach')
  })
})

// ===== 壳内默认层（shell-in-browser-login-default-attach v3 + shell-entry-platform-selector v1）=====
// 优先级：payload ?? (shellUi && 白名单 ? attach : 矩阵)
describe('resolveConnectMode 壳 UI 默认层（TC-S1~S9）', () => {
  it('TC-S1 [白名单固化] 抖音系三平台 = douyin + buyin + eos', () => {
    expect([...SHELL_DEFAULT_ATTACH_PLATFORMS].sort()).toEqual(['buyin', 'douyin', 'eos'])
  })
  it('TC-S2 [shellUi + douyin + 无 payload] → attach（压过矩阵 launch）', () => {
    expect(
      resolveConnectMode({
        platform: 'douyin',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S3 [shellUi + buyin] → attach', () => {
    expect(
      resolveConnectMode({
        platform: 'buyin',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S4 [shellUi + 非白名单 kuaishou] → 矩阵裁决不变', () => {
    expect(
      resolveConnectMode({
        platform: 'kuaishou',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('launch')
  })
  it('TC-S5 [shellUi + 白名单] → attach（恒定，不再有"降级期回外部"分支）', () => {
    expect(
      resolveConnectMode({
        platform: 'douyin',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S6 [逃生口 payload=launch 赢过壳内默认层]', () => {
    expect(
      resolveConnectMode({
        payloadMode: 'launch',
        platform: 'douyin',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('launch')
  })
  it('TC-S7 [shellUi=false 经典逐键不变]', () => {
    for (const platform of ['douyin', 'buyin', 'kuaishou']) {
      expect(resolveConnectMode({ platform, matrix: defaultEnvMatrix })).toBe(
        defaultEnvMatrix[platform as keyof typeof defaultEnvMatrix] ?? 'launch',
      )
    }
  })

  // eos（抖音团购）纳入白名单依据：douyin-eos/login 优先 goto 登录页、无弹窗回退路径（attach 安全）
  it('TC-S8 [shellUi + eos] → attach（抖音团购同链路，压过矩阵 launch）', () => {
    expect(
      resolveConnectMode({
        platform: 'eos',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })
  it('TC-S9 [shellUi + eos] → attach（恒定，无降级分支）', () => {
    expect(
      resolveConnectMode({
        platform: 'eos',
        matrix: defaultEnvMatrix,
        shellUiEnabled: true,
      }),
    ).toBe('attach')
  })

  // CV-I10：白名单恒 attach、taobao 恒 launch——删掉 degraded 后这两条必须钉死
  it('TC-S10 [白名单恒 attach] 壳 UI 开启时白名单平台恒为 attach', () => {
    for (const platform of SHELL_DEFAULT_ATTACH_PLATFORMS) {
      expect(
        resolveConnectMode({ platform, matrix: defaultEnvMatrix, shellUiEnabled: true }),
      ).toBe('attach')
    }
  })
  it('TC-S11 [taobao 恒 launch] 不在白名单的平台恒不因壳 UI 变 attach', () => {
    expect(
      resolveConnectMode({ platform: 'taobao', matrix: defaultEnvMatrix, shellUiEnabled: true }),
    ).toBe('launch')
  })
})

describe('runtimeEnvState（TC-U5 ~ TC-U6, TC-U13）', () => {
  it('TC-U5 [不回写] 裁决不修改静态矩阵', () => {
    const snapshot = { ...matrix }
    resolveConnectMode({ platform: 'douyin', matrix })
    expect(matrix).toEqual(snapshot)
  })

  it('TC-U5b [降级层已删除] runtimeEnvState 不再暴露 degrade/isDegraded/clear', () => {
    const state = createRuntimeEnvState()
    expect('degrade' in state).toBe(false)
    expect('isDegraded' in state).toBe(false)
    expect('clear' in state).toBe(false)
  })

  it('TC-U13 [F4] markStealthOff 记录标记且不影响 mode', () => {
    const state = createRuntimeEnvState()
    state.markStealthOff('douyin')
    expect(state.isStealthOff('douyin')).toBe(true)
    expect(resolveConnectMode({ platform: 'douyin', matrix })).toBe('attach')
  })
})
