import { describe, expect, it } from 'vitest'
import { resolveConnectModePayload } from './connectModePayload'

// ===== payload mode 映射决策表（v3 · R1 形态隔离铁律）=====
// 核心守护：uiStatus 决定读哪个开关——两字段永不交叉生效。
// undefined = 不传 mode，交主进程裁决链（壳 UI 白名单默认 attach / 矩阵）。

describe('resolveConnectModePayload 全组合（TC-M1~M9）', () => {
  it('TC-M1 壳UI × 逃生口开 → launch（显式，赢过壳内默认层）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: true, forceExternal: true, shellMode: false }),
    ).toBe('launch')
  })
  it('TC-M2 壳UI × 逃生口关 → undefined（交主进程：抖音系默认 attach）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: true, forceExternal: false, shellMode: false }),
    ).toBeUndefined()
  })
  it('TC-M3 [交叉污染防线] 壳UI × 逃生口关 × shellMode=true → undefined（不读旧开关）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: true, forceExternal: false, shellMode: true }),
    ).toBeUndefined()
  })
  it('TC-M4 经典 × 实验开关开 → attach（原语义零变化）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: false, forceExternal: false, shellMode: true }),
    ).toBe('attach')
  })
  it('TC-M5 经典 × 实验开关关 → undefined（矩阵裁决）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: false, forceExternal: false, shellMode: false }),
    ).toBeUndefined()
  })
  it('TC-M6 [交叉污染防线] 经典 × forceExternal=true → undefined（逃生口不越形态生效）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: false, forceExternal: true, shellMode: false }),
    ).toBeUndefined()
  })
  it('TC-M7 经典 × forceExternal=true × shellMode=true → attach（仍只读 shellMode）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: false, forceExternal: true, shellMode: true }),
    ).toBe('attach')
  })
  it('TC-M8 壳UI × 双开 → launch（逃生口优先，形态内唯一可读字段）', () => {
    expect(
      resolveConnectModePayload({ uiStatus: true, forceExternal: true, shellMode: true }),
    ).toBe('launch')
  })
  it('TC-M9 [纯性] 同输入两次调用结果一致', () => {
    const input = { uiStatus: true, forceExternal: false, shellMode: true }
    expect(resolveConnectModePayload(input)).toBe(resolveConnectModePayload(input))
  })
})
