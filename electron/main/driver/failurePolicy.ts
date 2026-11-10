// F1-F5 失败模式分档状态机（browser-shell-formalization-plan v3 · Phase 0）
// 纯函数状态机，供会话层消费；契约见 failurePolicy.test.ts（TC-U11~U12c）。
//
// 壳 v3 · Wave 1（计划 §3.3）：本文件的 `degrade` 只是**分档状态机内部的一个标记**，
// 不是 envMatrix/runtimeEnvState 那一支"运行时降级"。算法原样保留，语义如下：
//   - 历史说明，已无生产写者：降级信号（`RebuildAction='degrade'`）原先会被
//     envMatrix 消费（attach 失败 → 换外部浏览器）。该消费点已删除（Wave 1）。
//   - 现在 `degrade` 仅表示"重建预算耗尽"，供本状态机自身幂等短路使用。
//   - ⚠️ 与评论链路（staleWatcher / RealChromeCommentBackend / contracts）里的
//     `degraded`（评论数据陈旧）**不是一回事**，禁止一并替换。
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
