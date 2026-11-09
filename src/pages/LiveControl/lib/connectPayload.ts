import { resolveConnectModePayload } from './connectModePayload'

// 连接 payload 构造纯函数（shell-entry-platform-selector v1 · 业务树编排复用）
// 唯一构造点：面板 StatusCard 按钮与壳入口 entryIntent 共用同一份构造逻辑，
// 消除「第二个连接入口只能复制手拼 payload」的漂移隐患（计划 Proposed Changes 6）。
// v3 形态隔离规则不在本文件重复实现，一律委托 resolveConnectModePayload（决策表测试守护）。
export type ConnectPayloadInput = {
  platform: LiveControlPlatform
  account: Account
  headless: boolean
  chromePath: string | undefined
  storageState: string | undefined
  forceExternal: boolean
}

export type ConnectPayload = {
  headless: boolean
  chromePath?: string
  storageState?: string
  platform: LiveControlPlatform
  account: Account
  mode?: 'attach' | 'launch'
}

export function buildConnectPayload(input: ConnectPayloadInput): ConnectPayload {
  const mode = resolveConnectModePayload({ forceExternal: input.forceExternal })

  return {
    // 淘宝会触发人机验证：强制关闭无头模式，保证窗口可见（与既有面板连接行为一致）
    headless: input.platform === 'taobao' ? false : input.headless,
    chromePath: input.chromePath,
    storageState: input.storageState,
    platform: input.platform,
    account: input.account,
    // undefined = 不传 mode 键（而非 mode: undefined），交主进程裁决链决定形态
    ...(mode ? { mode } : {}),
  }
}
