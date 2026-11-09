import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron'
import type { IpcChannels } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'

// ===== IPC 来源授权（W2 · 声明式，替代单点手写守卫）=====
// 旧问题：`typedIpcMainHandle` 只做类型包装，来源约束靠各 handler 手写（全仓仅 commentBackend 一处，
// 且用 `/dist/rail.html` 判据 → dev URL 不含 /dist/ 直接误杀）。手写守卫的问题是"新增 handler 默认漏"，
// 单改判据治不了。这里改成：**通道级声明表 + 统一前置校验**，新增受限通道必须登记，漏登记由
// trustCoverage.test.ts 的源码扫描兜住。
//
// 零回归原则：**未在 CHANNEL_TRUST 声明的通道不执行来源校验**（52 处注册里 50 处行为完全不变）。

/** 本地受信视图身份（pageView 官方远程页不在此列：无 preload + nodeIntegration:false，天然不可达） */
export type ShellViewKind =
  | 'rail'
  | 'chrome'
  | 'workspace'
  | 'entry'
  | 'notice'
  | 'drag'
  | 'assistant'
  | 'unknown'

/**
 * 信任级别：
 * - `business-ui`：承载业务 UI 的本地视图（壳 rail 完整业务树）。评论面板只在 rail 渲染。
 * - chrome / entry / notice 只做壳级 UI，不需要业务通道 ⇒ 拒绝（缩小暴露面）。
 */
export type TrustLevel = 'business-ui' | 'ai-ui' | 'shell-ui'

const BUSINESS_UI_KINDS: readonly ShellViewKind[] = ['rail']
const AI_UI_KINDS: readonly ShellViewKind[] = ['rail', 'assistant']
const SHELL_UI_KINDS: readonly ShellViewKind[] = ['chrome', 'rail', 'workspace', 'assistant']

export const CHANNEL_TRUST: Partial<Record<keyof IpcChannels, TrustLevel>> = {
  [IPC_CHANNELS.tasks.commentBackend.getState]: 'business-ui',
  [IPC_CHANNELS.tasks.commentBackend.send]: 'business-ui',
  [IPC_CHANNELS.tasks.commentBackend.debugInject]: 'business-ui',
  // AI 配置/对话：rail（AutoReply）与 assistant（浮窗）都能用，chrome/entry/notice 不能。
  [IPC_CHANNELS.tasks.aiChat.chat]: 'ai-ui',
  [IPC_CHANNELS.tasks.aiChat.abort]: 'ai-ui',
  [IPC_CHANNELS.tasks.aiChat.normalChat]: 'ai-ui',
  [IPC_CHANNELS.tasks.aiChat.testApiKey]: 'ai-ui',
  [IPC_CHANNELS.aiProvider.get]: 'ai-ui',
  [IPC_CHANNELS.aiProvider.set]: 'ai-ui',
  [IPC_CHANNELS.aiProvider.migrate]: 'ai-ui',
  // 顶栏/浮窗控制：chrome 可发 toggle；close/ready 由 assistant 发，rail 仍保留入口。
  [IPC_CHANNELS.shell.assistantToggle]: 'shell-ui',
  [IPC_CHANNELS.shell.assistantClose]: 'shell-ui',
  [IPC_CHANNELS.shell.assistantReady]: 'shell-ui',
  // 第二期：账号单一源与 workspace 数据只允许本地壳视图。
  [IPC_CHANNELS.account.get]: 'shell-ui',
  [IPC_CHANNELS.account.add]: 'shell-ui',
  [IPC_CHANNELS.account.remove]: 'shell-ui',
  [IPC_CHANNELS.account.rename]: 'shell-ui',
  [IPC_CHANNELS.account.migrate]: 'shell-ui',
  [IPC_CHANNELS.account.switch]: 'shell-ui',
  [IPC_CHANNELS.workspace.history]: 'shell-ui',
  [IPC_CHANNELS.shell.workspaceModeSet]: 'shell-ui',
  [IPC_CHANNELS.shell.workspaceOpenPanel]: 'shell-ui',
  [IPC_CHANNELS.shell.workspaceSnapshot]: 'shell-ui',
}

/** URL → 视图身份。dev（http://host/rail.html）与 prod（file:///.../dist/rail.html）都命中。 */
export function classifyViewUrl(url: string): ShellViewKind {
  if (!url) return 'unknown'
  for (const kind of [
    'rail',
    'chrome',
    'workspace',
    'entry',
    'notice',
    'drag',
    'assistant',
  ] as const) {
    if (url.includes(`/${kind}.html`)) return kind
  }
  return 'unknown'
}

type TrustResolver = (event: IpcMainInvokeEvent | IpcMainEvent) => ShellViewKind

/**
 * 判定器由装配层注入（`ipc/index.ts` 注册 URL 版；`shellUI.attachContainer` 覆盖为
 * webContents.id 精确版 + URL 兜底），避免 `utils → windows` 的循环依赖。
 * 未注册时不放行任何受限通道（fail-closed）。
 */
let trustResolver: TrustResolver | null = null

export function setTrustResolver(fn: TrustResolver | null): void {
  trustResolver = fn
}

/**
 * 默认判定器：只按 URL 认视图身份（dev 与打包都成立）。
 * **由装配层（app.ts）注册，不在 ipc/** 内注册** —— 否则"判定逻辑散在 handler 层"这一条
 * 就从另一个门爬回来，TC-GT3（ipc/** 零 sender.getURL）也就失去意义了。
 */
export function urlTrustResolver(event: IpcMainInvokeEvent | IpcMainEvent): ShellViewKind {
  return classifyViewUrl(event.sender.getURL())
}

/** 受限通道的来源校验：未声明则直接放行（零回归），已声明则按级别判定 */
function assertTrustedSender(channel: keyof IpcChannels, event: IpcMainInvokeEvent | IpcMainEvent) {
  const level = CHANNEL_TRUST[channel]
  if (!level) return

  const kind = trustResolver ? trustResolver(event) : 'unknown'
  const allowed =
    level === 'business-ui'
      ? BUSINESS_UI_KINDS.includes(kind)
      : level === 'ai-ui'
        ? AI_UI_KINDS.includes(kind)
        : SHELL_UI_KINDS.includes(kind)
  if (!allowed) {
    throw new Error(`IPC 拒绝：${String(channel)} 仅允许 ${level} 视图，实际来源 ${kind}`)
  }
}

export function typedIpcMainHandle<Channel extends keyof IpcChannels>(
  channel: Channel,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<IpcChannels[Channel]>
  ) => ReturnType<IpcChannels[Channel]> | Promise<ReturnType<IpcChannels[Channel]>>,
): void {
  ipcMain.handle(channel as string, (event, ...args: unknown[]) => {
    assertTrustedSender(channel, event)
    return (listener as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...args)
  })
}

export function typedIpcMainOn<Channel extends keyof IpcChannels>(
  channel: Channel,
  listener: (event: IpcMainEvent, ...args: Parameters<IpcChannels[Channel]>) => void,
): void {
  // on 通道暂未纳入声明表（本批只约束 commentBackend；见计划 q-1 与 N-3）
  ipcMain.on(channel as string, listener)
}
