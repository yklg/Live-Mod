import { describe, expect, it } from 'vitest'
import { createFailurePolicy } from '#/driver/failurePolicy'

// ===== F1-F5 失败模式分档状态机（评审 P1-3）=====
// 守护不变量：
//   I13 F2 阈值：Target closed 连续 3 次才升级重建，未达阈值只重试且计数保留
//   I14 F5 上限：重建最多 2 次，第 3 次事件直接 F3 降级，不再发起重建
//   I15 成功连接/操作清零计数（防跨会话累计误触发）

describe('createFailurePolicy（TC-U11 ~ TC-U12）', () => {
  it('TC-U11 [F2 阈值] 第 1/2 次 Target closed → retry，第 3 次 → rebuild', () => {
    const p = createFailurePolicy({ targetClosedThreshold: 3, rebuildLimit: 2 })
    expect(p.reportTargetClosed()).toBe('retry')
    expect(p.reportTargetClosed()).toBe('retry')
    expect(p.reportTargetClosed()).toBe('rebuild')
  })

  it('TC-U11b [清零] rebuild 后计数重置，再单发只 retry', () => {
    const p = createFailurePolicy({ targetClosedThreshold: 3, rebuildLimit: 2 })
    p.reportTargetClosed()
    p.reportTargetClosed()
    p.reportTargetClosed() // rebuild
    expect(p.reportTargetClosed()).toBe('retry')
  })

  it('TC-U11c [成功清零] reportSuccess 重置 F2 计数', () => {
    const p = createFailurePolicy({ targetClosedThreshold: 3, rebuildLimit: 2 })
    p.reportTargetClosed()
    p.reportTargetClosed()
    p.reportSuccess()
    expect(p.reportTargetClosed()).toBe('retry') // 从 0 起算，不到阈值
    expect(p.reportTargetClosed()).toBe('retry')
    expect(p.reportTargetClosed()).toBe('rebuild')
  })

  it('TC-U12 [F5 上限] 重建 2 次允许，第 3 次 → degrade 且不再 rebuild', () => {
    const p = createFailurePolicy({ targetClosedThreshold: 3, rebuildLimit: 2 })
    expect(p.requestRebuild()).toBe('granted')
    expect(p.requestRebuild()).toBe('granted')
    expect(p.requestRebuild()).toBe('degrade')
    expect(p.requestRebuild()).toBe('degrade') // 上限后永久 degrade，直到成功重置
  })

  it('TC-U12b [重建成功] reportSuccess 恢复重建预算', () => {
    const p = createFailurePolicy({ targetClosedThreshold: 3, rebuildLimit: 2 })
    p.requestRebuild()
    p.requestRebuild()
    p.reportSuccess()
    expect(p.requestRebuild()).toBe('granted')
  })

  it('TC-U12c [F5→F3 联动] degrade 状态可查询（供 runtimeEnvState 消费）', () => {
    const p = createFailurePolicy({ targetClosedThreshold: 3, rebuildLimit: 1 })
    p.requestRebuild()
    p.requestRebuild()
    expect(p.isDegraded()).toBe(true)
  })
})
