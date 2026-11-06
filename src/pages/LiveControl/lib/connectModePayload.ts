// 连接 payload mode 映射纯函数（shell-in-browser-login-default-attach v3 · R1 形态隔离）
// 铁律：uiStatus 决定读哪个开关——壳 UI 形态只认 forceExternal（逃生口），
// 经典形态只认 shellMode（实验开关）；两字段永不交叉生效，
// 杜绝「壳 UI 设的逃生口在经典模式隐形生效」的残留污染。
// undefined = 不传 mode 键，交由主进程裁决链（壳内默认层/矩阵）决定。
export type ConnectModePayload = 'attach' | 'launch' | undefined

export interface ConnectModePayloadInput {
  uiStatus: boolean
  forceExternal: boolean
  shellMode: boolean
}

export function resolveConnectModePayload({
  uiStatus,
  forceExternal,
  shellMode,
}: ConnectModePayloadInput): ConnectModePayload {
  if (uiStatus) return forceExternal ? 'launch' : undefined
  return shellMode ? 'attach' : undefined
}
