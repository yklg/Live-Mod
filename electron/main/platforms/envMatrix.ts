// 平台 × 执行环境静态矩阵（browser-shell-formalization-plan v3 · 总原则 2 / A2）
// 唯一事实源：每平台默认执行环境。验收通过的平台在此改 'attach'（代码变更，走评审）。
// 运行时偶发降级不写这里——那是 runtimeEnvState 的职责（A2 两层分离）。
export type ExecMode = 'launch' | 'attach'

/** 初始全 launch：壳模式逐平台经 Phase 1/3 验收后切换 */
export const defaultEnvMatrix: Partial<Record<LiveControlPlatform, ExecMode>> = {
  douyin: 'launch',
  buyin: 'launch',
  kuaishou: 'launch',
  taobao: 'launch',
  wxchannel: 'launch',
  xiaohongshu: 'launch',
  'xiaohongshu-pgy': 'launch',
  dev: 'launch',
}

export interface ConnectModeInput {
  payloadMode?: ExecMode | null
  platform: LiveControlPlatform | string
  degraded: boolean
  matrix?: Partial<Record<string, ExecMode>>
}

/**
 * mode 裁决唯一纯函数（A3：消费点在 ipc/connection，优先级链）：
 * payload.mode ?? (degraded ? 'launch' : matrix[platform] ?? 'launch')
 * 显式 payload 永远赢——包括 degraded 时人工指定 attach（TC-U4 决策表固化）。
 */
export function resolveConnectMode(input: ConnectModeInput): ExecMode {
  if (input.payloadMode) return input.payloadMode
  if (input.degraded) return 'launch'
  return input.matrix?.[input.platform] ?? 'launch'
}
