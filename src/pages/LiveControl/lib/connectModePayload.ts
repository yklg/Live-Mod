// 连接 payload mode 映射纯函数（shell-in-browser-login-default-attach v3 · R1）
// 壳 UI 是唯一运行形态（经典模式已移除）：连接方式的唯一用户可见开关是「强制外部浏览器」逃生口。
// undefined = 不传 mode 键，交由主进程裁决链（壳内默认层：抖音系白名单平台默认 attach）。
export type ConnectModePayload = 'attach' | 'launch' | undefined

export interface ConnectModePayloadInput {
  /** 壳内默认 attach 的逃生口：开启后改由外部 Chrome/Edge 承载（调试/风控兜底） */
  forceExternal: boolean
}

export function resolveConnectModePayload({
  forceExternal,
}: ConnectModePayloadInput): ConnectModePayload {
  return forceExternal ? 'launch' : undefined
}
