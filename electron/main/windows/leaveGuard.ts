// 导航离开护栏决策（guangquan-shell-ui-parity v3 · P2-6）——纯函数。
// 契约（leaveGuard.test.ts TC-N1 固化）：仅「账号 Tab ∧ 任务运行中 ∧ 离开 controlHost」三条件同时成立才告警；
// 任何无法判定输入（畸形/非 http(s)）归不告警——提示性副作用，误报比漏报代价高（与 popupPolicy I18 反向保守）。
// 不阻断导航：liveStatusWatcher 已有缺席防抖容错。

export interface LeaveGuardInput {
  kind: 'account' | 'free'
  taskRunning: boolean
  toUrl: string
  controlHost: string
}

export function shouldWarnLeaveControlPage({
  kind,
  taskRunning,
  toUrl,
  controlHost,
}: LeaveGuardInput): boolean {
  if (kind !== 'account') return false
  if (!taskRunning) return false
  let host: string
  try {
    const u = new URL(toUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    host = u.hostname.toLowerCase()
  } catch {
    return false
  }
  return host !== controlHost.toLowerCase()
}
