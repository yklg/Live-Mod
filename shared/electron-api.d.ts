import type { LogMessage } from 'electron-log'
import type { ProgressInfo, UpdateDownloadedEvent } from 'electron-updater'
import type { AccountAction, AccountSnapshot } from './accounts'
import type { AIProviderSetPayload, AIProviderState } from './aiProvider'
import { IPC_CHANNELS } from './ipcChannels'
import type { ShellChromeState, ShellMode } from './shellState'

/**
 * 连接结果（壳 v3 · Wave 1 · P0-1）。
 *
 * 契约升级的原因：旧契约返回 `boolean`，把「用户主动断开（正常结束）」与
 * 「真失败」抹平成同一个 false，渲染层无法区分，只能弹一条「连接失败」。
 * 更糟的是主进程在 attach 失败时直接降级回退外部浏览器，于是用户手动断开
 * 也会看到「已回退外部浏览器登录」。
 *
 * 三形态：
 * - `{ ok: true }`：连接成功。
 * - `{ ok: false, aborted: true, connectId }`：用户主动断开/重启 → **静默**，不弹任何通知。
 * - `{ ok: false, aborted?: false, reason, kind }`：真失败 → 由主进程推**一条**通知，
 *   `kind` 是判别式（attach / page-closed / timeout / other），便于按类型分文案。
 */
export type ConnectResult =
  | { ok: true }
  | { ok: false; aborted: true; connectId: string }
  | {
      ok: false
      aborted?: false
      reason: string
      kind: 'attach' | 'page-closed' | 'timeout' | 'other'
    }

export interface IpcChannels {
  // LiveControl
  [IPC_CHANNELS.tasks.liveControl.connect]: (params: {
    chromePath?: string
    headless?: boolean
    storageState?: string
    platform: LiveControlPlatform
    account: Account
    /** 壳模式显式覆盖（裁决链最高优先级）；缺省时由壳内默认层/静态矩阵裁决 */
    mode?: 'launch' | 'attach'
  }) => ConnectResult
  [IPC_CHANNELS.tasks.liveControl.disconnect]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.liveControl.disconnectedEvent]: (id: string) => void
  [IPC_CHANNELS.tasks.liveControl.liveEndedEvent]: (id: string) => void
  [IPC_CHANNELS.tasks.liveControl.notifyAccountName]: (
    params:
      | {
          ok: true
          accountId: string
          accountName: string | null
        }
      | { ok: false },
  ) => void

  // AutoMessage
  [IPC_CHANNELS.tasks.autoMessage.start]: (accountId: string, config: AutoCommentConfig) => boolean
  [IPC_CHANNELS.tasks.autoMessage.stop]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.autoMessage.stoppedEvent]: (id: string) => void
  [IPC_CHANNELS.tasks.autoMessage.sendBatchMessages]: (
    accountId: string,
    messages: string[],
    count: number,
  ) => boolean
  [IPC_CHANNELS.tasks.autoMessage.updateConfig]: (
    accountId: string,
    config: Parital<AutoCommentConfig>,
  ) => void

  // AutoPopup
  [IPC_CHANNELS.tasks.autoPopUp.start]: (accountId: string, config: AutoPopupConfig) => boolean
  [IPC_CHANNELS.tasks.autoPopUp.stop]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.autoPopUp.stoppedEvent]: (id: string) => void
  [IPC_CHANNELS.tasks.autoPopUp.updateConfig]: (
    accountId: string,
    config: Parital<AutoPopupConfig>,
  ) => void
  [IPC_CHANNELS.tasks.autoPopUp.registerShortcuts]: (
    accountId: string,
    shortcuts: { accelerator: string; goodsIds: number[] }[],
  ) => void
  [IPC_CHANNELS.tasks.autoPopUp.unregisterShortcuts]: () => void

  // AutoReply
  [IPC_CHANNELS.tasks.autoReply.startCommentListener]: (
    accountId: string,
    config: CommentListenerConfig,
  ) => boolean
  [IPC_CHANNELS.tasks.autoReply.stopCommentListener]: (accountId: string) => void
  [IPC_CHANNELS.tasks.autoReply.sendReply]: (accountId: string, replyContent: string) => void
  [IPC_CHANNELS.tasks.autoReply.listenerStopped]: (accountId: string) => void
  [IPC_CHANNELS.tasks.autoReply.showComment]: (data: {
    comment: LiveMessage
    accountId: string
  }) => void

  // CommentBackend（B2 阅读链路：headless 真实 Chrome → 壳内直播互动面板）
  [IPC_CHANNELS.tasks.commentBackend.status]: (payload: {
    accountId: string
    status: {
      state: 'idle' | 'starting' | 'live' | 'degraded' | 'stopped' | 'error'
      comments: number
      lastCommentAt?: number
      lastFreshAt?: number
      degradedReason?: 'no-data' | 'poll-miss'
      error?: string
    }
  }) => void
  [IPC_CHANNELS.tasks.commentBackend.comment]: (payload: {
    accountId: string
    comment: { id: string; nickName: string; content: string; at: number }
  }) => void
  [IPC_CHANNELS.tasks.commentBackend.send]: (
    accountId: string,
    content: string,
  ) => { ok: boolean; error?: string }
  [IPC_CHANNELS.tasks.commentBackend.getState]: () => {
    accounts: {
      accountId: string
      status: {
        state: 'idle' | 'starting' | 'live' | 'degraded' | 'stopped' | 'error'
        comments: number
        lastCommentAt?: number
        lastFreshAt?: number
        degradedReason?: 'no-data' | 'poll-miss'
        error?: string
      }
      /** 最近历史（主进程 store 快照，按 at 升序，最多 100 条） */
      comments: { id: string; nickName: string; content: string; at: number }[]
    }[]
    /** 调试注入是否可用（LM_SHELL_DEBUG=1）；面板据此决定是否显示"注入测试评论"按钮 */
    debug: boolean
  }
  /** 仅 LM_SHELL_DEBUG=1 注册；无真实直播时用于验收面板显示/回放 */
  [IPC_CHANNELS.tasks.commentBackend.debugInject]: (text: string) => {
    ok: boolean
    accountId?: string
    error?: string
  }

  // AIChat
  [IPC_CHANNELS.tasks.aiChat.normalChat]: (params: {
    messages: AIChatMessage[]
    provider: string
    model: string
    apiKey: string
    customBaseURL?: string
  }) => string | null
  [IPC_CHANNELS.tasks.aiChat.testApiKey]: (params: {
    apiKey: string
    provider: string
    customBaseURL?: string
  }) => { success: boolean; models?: string[]; error?: string }
  [IPC_CHANNELS.tasks.aiChat.chat]: (params: {
    messages: AIChatMessage[]
    provider: string
    model: string
    apiKey: string
    customBaseURL?: string
    requestId?: string
  }) => void
  [IPC_CHANNELS.tasks.aiChat.abort]: (requestId: string) => void
  [IPC_CHANNELS.tasks.aiChat.stream]: (
    data:
      | {
          chunk: string
          type: 'content' | 'reasoning'
          requestId?: string
        }
      | { done: boolean; requestId?: string; aborted?: boolean },
  ) => void
  [IPC_CHANNELS.tasks.aiChat.error]: (data: { error: string; requestId?: string }) => void

  // 视频号上墙
  [IPC_CHANNELS.tasks.pinComment]: (params: { accountId: string; content: string }) => void

  // 一键发红包
  [IPC_CHANNELS.tasks.redPacket.send]: (accountId: string, duration: string) => boolean

  // Updater
  [IPC_CHANNELS.updater.checkUpdate]: () => Promise<
    { latestVersion: string; currentVersion: string; releaseNote?: string } | undefined
  >
  [IPC_CHANNELS.updater.startDownload]: (source: string) => void
  [IPC_CHANNELS.updater.quitAndInstall]: () => void
  [IPC_CHANNELS.updater.updateAvailable]: (info: VersionInfo) => void
  [IPC_CHANNELS.updater.updateError]: (error: ErrorType) => void
  [IPC_CHANNELS.updater.downloadProgress]: (progress: ProgressInfo) => void
  [IPC_CHANNELS.updater.updateDownloaded]: (event?: UpdateDownloadedEvent) => void

  // Chrome
  [IPC_CHANNELS.chrome.selectPath]: () => string | null
  [IPC_CHANNELS.chrome.getPath]: (edge?: boolean) => string | null
  [IPC_CHANNELS.chrome.toggleDevTools]: () => void
  [IPC_CHANNELS.chrome.setPath]: (path: string) => void
  [IPC_CHANNELS.chrome.saveState]: (accountId: string, state: string) => void

  // App
  [IPC_CHANNELS.app.openLogFolder]: () => void
  [IPC_CHANNELS.app.openExternal]: (url: string) => void
  [IPC_CHANNELS.app.notifyUpdate]: (arg: {
    currentVersion: string
    latestVersion: string
    releaseNote?: string
  }) => void
  [IPC_CHANNELS.app.getProviders]: () => Record<string, ProviderInfo>
  [IPC_CHANNELS.app.providersUpdated]: (providers: Record<string, ProviderInfo>) => void

  [IPC_CHANNELS.account.switch]: (params: { account: Account }) => AccountAction
  [IPC_CHANNELS.account.get]: () => AccountSnapshot
  [IPC_CHANNELS.account.add]: (name: string) => AccountAction
  [IPC_CHANNELS.account.remove]: (accountId: string) => AccountAction
  [IPC_CHANNELS.account.rename]: (accountId: string, name: string) => AccountAction
  [IPC_CHANNELS.account.migrate]: (legacy: unknown) => AccountSnapshot
  [IPC_CHANNELS.account.updated]: (snapshot: AccountSnapshot) => void

  // Log
  [IPC_CHANNELS.log]: (message: LogMessage) => void

  // AI 配置单一源（主进程 AIProviderStore）
  [IPC_CHANNELS.aiProvider.get]: () => { state: AIProviderState; migrated: boolean }
  [IPC_CHANNELS.aiProvider.set]: (payload: AIProviderSetPayload) => void
  [IPC_CHANNELS.aiProvider.migrate]: (legacy: unknown) => AIProviderState
  [IPC_CHANNELS.aiProvider.state]: (state: AIProviderState) => void

  // Shell（光圈式壳界面 guangquan-shell-ui-parity v3）
  [IPC_CHANNELS.shell.tabCreate]: (params: { url?: string; accountId?: string }) => number
  [IPC_CHANNELS.shell.tabClose]: (id: number) => void
  [IPC_CHANNELS.shell.tabActivate]: (id: number) => void
  [IPC_CHANNELS.shell.tabNavigate]: (id: number, url: string) => Promise<void>
  [IPC_CHANNELS.shell.tabBack]: (id: number) => void
  [IPC_CHANNELS.shell.tabForward]: (id: number) => void
  [IPC_CHANNELS.shell.tabReload]: (id: number) => void
  [IPC_CHANNELS.shell.tabMove]: (id: number, toIndex: number) => void
  [IPC_CHANNELS.shell.tabCloseBatch]: (ids: number[]) => void
  [IPC_CHANNELS.shell.tabReopen]: () => number | null
  [IPC_CHANNELS.shell.panelDragBegin]: (startWidth: number, startScreenX: number) => void
  [IPC_CHANNELS.shell.panelResize]: (screenX: number) => void
  [IPC_CHANNELS.shell.panelResizeEnd]: () => void
  [IPC_CHANNELS.shell.assistantToggle]: () => void
  [IPC_CHANNELS.shell.assistantClose]: () => void
  [IPC_CHANNELS.shell.assistantState]: (open: boolean) => void
  [IPC_CHANNELS.shell.assistantReady]: () => void
  [IPC_CHANNELS.shell.tabsList]: () => ShellTabsState
  [IPC_CHANNELS.shell.tabsState]: (state: ShellTabsState) => void
  [IPC_CHANNELS.shell.windowMinimize]: () => void
  [IPC_CHANNELS.shell.windowMaximize]: () => void
  [IPC_CHANNELS.shell.windowClose]: () => void
  [IPC_CHANNELS.shell.railToggle]: (routeId?: string | null) => void
  [IPC_CHANNELS.shell.railState]: (state: ShellRailState) => void
  // 顶栏悬浮菜单（壳 v3 · Wave 3）
  [IPC_CHANNELS.shell.railMenuToggle]: () => void
  [IPC_CHANNELS.shell.railMenuSelect]: (routeId: string) => void
  [IPC_CHANNELS.shell.warnToast]: (message: string) => void
  [IPC_CHANNELS.shell.uiStatus]: () => boolean
  [IPC_CHANNELS.shell.resetLoginState]: (accountId: string) => Promise<void>
  // 壳入口平台选择器（shell-entry-platform-selector v1）：
  // 入口=纯展示（拉目录/发选择/跳过）；intent→rail 完整业务树编排连接（单一连接通道）
  [IPC_CHANNELS.shell.entryCatalog]: () => ShellEntryCatalog
  [IPC_CHANNELS.shell.entrySelect]: (params: {
    platform: LiveControlPlatform
    remember: boolean
  }) => { ok: boolean; reason?: 'unknown' | 'unsupported' | 'shell-disabled' | 'shell-not-ready' }
  [IPC_CHANNELS.shell.entryIntent]: (intent: {
    platform: LiveControlPlatform
    source: 'manual' | 'restore'
  }) => void
  [IPC_CHANNELS.shell.entrySkip]: () => void
  [IPC_CHANNELS.shell.entryReopen]: () => void
  [IPC_CHANNELS.shell.entryRememberSet]: (autoRestore: boolean | null) => boolean
  [IPC_CHANNELS.shell.railReady]: () => void
  [IPC_CHANNELS.shell.modeState]: (state: ShellChromeState) => void
  [IPC_CHANNELS.shell.modeSet]: (mode: ShellMode) => void
  [IPC_CHANNELS.shell.modeSnapshot]: () => ShellChromeState
  // 壳级通知层（shell-ui-polish v3）：renderer 请求 → 主进程校验/缓冲 → 覆盖层渲染
  [IPC_CHANNELS.shell.notify]: (payload: NoticePayload) => { ok: boolean }
  [IPC_CHANNELS.shell.notice]: (payload: NoticePayload) => void
  [IPC_CHANNELS.shell.noticeReady]: () => void
}

export interface ShellTabInfo {
  id: number
  title: string
  url: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  active: boolean
  kind: 'account' | 'free' | 'popup'
}

export interface ShellTabsState {
  tabs: ShellTabInfo[]
  activeId: number
}

export interface ShellRailState {
  panelOpen: boolean
  routeId: string | null
  /**
   * 顶栏悬浮菜单是否打开（壳 v3 · Wave 3）。
   * 与 panelOpen 互斥：菜单开时面板让位，选中项后菜单关、面板开。
   */
  menuOpen: boolean
}

export interface ElectronAPI {
  ipcRenderer: {
    invoke: <Channel extends keyof IpcChannels>(
      channel: Channel,
      ...args: Parameters<IpcChannels[Channel]>
    ) => ReturnType<IpcChannels[Channel]> extends Promise<infer _U>
      ? ReturnType<IpcChannels[Channel]>
      : Promise<ReturnType<IpcChannels[Channel]>>

    send: <Channel extends keyof IpcChannels>(
      channel: Channel,
      ...args: Parameters<IpcChannels[Channel]>
    ) => void

    on: <Channel extends keyof IpcChannels>(
      channel: Channel,
      listener: (...args: Parameters<IpcChannels[Channel]>) => void,
    ) => () => void
  }
}
