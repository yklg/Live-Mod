// 连接 payload 构造纯函数（shell-entry-platform-selector v1 · 业务树编排复用）
// 唯一构造点：面板 StatusCard 按钮与壳入口 entryIntent 共用同一份构造逻辑，
// 消除「第二个连接入口只能复制手拼 payload」的漂移隐患（计划 Proposed Changes 6）。
//
// 壳 v3 · Wave 1：「强制外部浏览器」逃生口已移除（计划 §3.4），
// 因此渲染层不再产出 mode —— 形态完全由主进程裁决链决定：
// payload.mode ?? (壳 UI 开启且平台在白名单 → attach) ?? 静态矩阵 ?? 'launch'。
export type ConnectPayloadInput = {
  platform: LiveControlPlatform
  account: Account
  headless: boolean
  chromePath: string | undefined
  storageState: string | undefined
}

export type ConnectPayload = {
  headless: boolean
  chromePath?: string
  storageState?: string
  platform: LiveControlPlatform
  account: Account
}

export function buildConnectPayload(input: ConnectPayloadInput): ConnectPayload {
  return {
    // 淘宝会触发人机验证：强制关闭无头模式，保证窗口可见（与既有面板连接行为一致）
    headless: input.platform === 'taobao' ? false : input.headless,
    chromePath: input.chromePath,
    storageState: input.storageState,
    platform: input.platform,
    account: input.account,
  }
}
