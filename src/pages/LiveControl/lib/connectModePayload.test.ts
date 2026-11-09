import { describe, expect, it } from 'vitest'
import { resolveConnectModePayload } from './connectModePayload'

// ===== payload mode 映射（经典模式移除后的口径）=====
// undefined = 不传 mode，交主进程裁决链（壳内默认层：抖音系白名单平台默认 attach）。
describe('resolveConnectModePayload', () => {
  it('TC-M1 逃生口开 → launch（显式，赢过壳内默认层）', () => {
    expect(resolveConnectModePayload({ forceExternal: true })).toBe('launch')
  })
  it('TC-M2 逃生口关 → undefined（交主进程默认 attach）', () => {
    expect(resolveConnectModePayload({ forceExternal: false })).toBeUndefined()
  })
  it('TC-M3 [纯性] 同输入两次调用结果一致', () => {
    const input = { forceExternal: false }
    expect(resolveConnectModePayload(input)).toBe(resolveConnectModePayload(input))
  })
})
