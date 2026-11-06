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
  pgy: 'launch',
  dev: 'launch',
}

/**
 * 壳 UI 默认壳内登录（attach）的平台白名单（shell-in-browser-login-default-attach v3 · 决策 1；
 * shell-entry-platform-selector v1 增补 eos）。
 * 抖音系先行（douyin 已实测 fxg 登录页可壳内承载；buyin 同链路）；
 * eos（抖音团购）：douyin-eos/login 优先 goto 登录页、无弹窗回退路径（REGEXPS.LOGIN_PAGE 命中即不跳转），attach 安全；
 * 后续平台验收通过 = 此处加一项，裁决函数与其他代码零改动（OCP）。
 */
export const SHELL_DEFAULT_ATTACH_PLATFORMS: readonly string[] = ['douyin', 'buyin', 'eos']

export interface ConnectModeInput {
  payloadMode?: ExecMode | null
  platform: LiveControlPlatform | string
  degraded: boolean
  matrix?: Partial<Record<string, ExecMode>>
  /** 壳 UI（光圈式容器）是否启用——启用时白名单平台默认 attach，不依赖每账号实验开关 */
  shellUiEnabled?: boolean
}

/**
 * mode 裁决唯一纯函数（A3：消费点在 ipc/connection，优先级链）：
 * payload.mode
 *   ?? (shellUiEnabled && 白名单平台 ? (degraded ? launch : attach)  // 壳内默认层（v3）
 *      : degraded ? launch
 *      : matrix[platform] ?? launch)
 * 显式 payload 永远赢——含逃生口显式 'launch'（degraded 时人工指定 attach 亦赢，TC-U4 决策表固化）。
 */
export function resolveConnectMode(input: ConnectModeInput): ExecMode {
  if (input.payloadMode) return input.payloadMode
  if (input.shellUiEnabled && SHELL_DEFAULT_ATTACH_PLATFORMS.includes(input.platform)) {
    // 壳内默认层：白名单平台在壳 UI 下默认 attach；降级期内回外部（TTL 过期自动恢复）
    return input.degraded ? 'launch' : 'attach'
  }
  if (input.degraded) return 'launch'
  return input.matrix?.[input.platform] ?? 'launch'
}
