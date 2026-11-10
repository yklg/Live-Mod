import type { ConnectResult } from 'shared/electron-api'

/**
 * 连接结果的渲染层分支（壳 v3 · Wave 1 · P0-1）。
 *
 * 为什么单独抽成纯函数：连接结果有**三态**（成功 / 用户中止 / 真失败），
 * 三态在渲染层的表现完全不同（弹成功 toast / 完全静默 / 静默但主进程已推通知）。
 * 把判定抽出来，才能在不搭 React 测试环境（仓内 vitest 是 node 环境、无 testing-library）
 * 的前提下，对「渲染层分支」做可执行断言——否则这条链路会假绿。
 *
 * 契约（与主进程 handler 一一对应）：
 * - success：状态置 connected，弹一条成功 toast。
 * - aborted：用户主动断开/重启。状态置 disconnected，**不弹任何 toast**（静默）。
 * - failed：真失败。状态置 disconnected，**不弹 toast**——失败通知只由主进程推一条
 *   （单份通知，计划 §3.2 / P1-3），渲染层再补一条会出现两条文案不一致的重复通知。
 */
export type ConnectBranch = 'success' | 'aborted' | 'failed'

export type ConnectOutcome = {
  /** 连接状态机目标值 */
  status: 'connected' | 'disconnected'
  /** 渲染层要弹的 toast：只有成功才弹；失败与中止都不弹 */
  toast: 'success' | 'none'
}

/** 判定连接结果落在哪个分支（测试与日志都用它，避免三态判断散落各处） */
export function connectBranch(result: ConnectResult): ConnectBranch {
  if (result.ok) return 'success'
  return result.aborted ? 'aborted' : 'failed'
}

/** 把连接结果映射成渲染层动作 */
export function resolveConnectOutcome(result: ConnectResult): ConnectOutcome {
  if (result.ok) return { status: 'connected', toast: 'success' }
  return { status: 'disconnected', toast: 'none' }
}
