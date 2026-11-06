// F1-F5 失败模式分档状态机（browser-shell-formalization-plan v3 · Phase 0）
// 纯函数状态机，供会话层消费；契约见 failurePolicy.test.ts（TC-U11~U12c）。
export interface FailurePolicyOptions {
  /** F2：Target closed 连续几次升级重建 */
  targetClosedThreshold: number
  /** F5：重建预算上限，超出即 F3 降级 */
  rebuildLimit: number
}

export type TargetClosedAction = 'retry' | 'rebuild'
export type RebuildAction = 'granted' | 'degrade'

export function createFailurePolicy(opts: FailurePolicyOptions) {
  let targetClosedStreak = 0
  let rebuildsUsed = 0
  let degraded = false

  return {
    /** F2：evaluate 抛 Target closed。达阈值返回 rebuild 并清零计数 */
    reportTargetClosed(): TargetClosedAction {
      targetClosedStreak++
      if (targetClosedStreak >= opts.targetClosedThreshold) {
        targetClosedStreak = 0
        return 'rebuild'
      }
      return 'retry'
    },
    /** F5：请求重建。预算耗尽 → degrade（=F3 降级信号），永久直至成功重置 */
    requestRebuild(): RebuildAction {
      if (degraded) return 'degrade'
      if (rebuildsUsed >= opts.rebuildLimit) {
        degraded = true
        return 'degrade'
      }
      rebuildsUsed++
      return 'granted'
    },
    /** 任一成功信号清零全部计数（I15 防跨会话累计误触发） */
    reportSuccess(): void {
      targetClosedStreak = 0
      rebuildsUsed = 0
      degraded = false
    },
    isDegraded(): boolean {
      return degraded
    },
  }
}
