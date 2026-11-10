import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { browserManager } from '#/managers/BrowserSessionManager'
import { connectionFailureKind, connectionFailureReason } from '#/errors/connectionError'
import { defaultEnvMatrix, resolveConnectMode } from '#/platforms/envMatrix'
import { typedIpcMainHandle } from '#/utils'
import { pushNotice } from '#/windows/noticeBus'
import { isShellUIEnabled, shellModeSet } from '#/windows/shellUI'

const TASK_NAME = '中控台'

/** 失败文案的 kind 描述（通知与日志共用，措辞一致便于对账） */
const KIND_LABEL: Record<string, string> = {
  attach: '壳内连接失败',
  'page-closed': '中控台页面已关闭',
  timeout: '连接超时',
  other: '连接失败',
}

function setupIpcHandlers() {
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.liveControl.connect,
    async (_, { chromePath, headless, storageState, platform, account, mode: payloadMode }) => {
      const logger = createLogger(`@${account.name}`).scope(TASK_NAME)
      // 裁决唯一消费点（壳 v3 · Wave 1：删除「运行时降级」这一层）：
      // payload.mode ?? (壳内默认层：壳 UI 开启且平台在白名单) ?? 静态矩阵 ?? 'launch'
      // 显式 payload 永远赢——它是唯一的人工逃生口。
      const mode = resolveConnectMode({
        payloadMode,
        platform,
        matrix: defaultEnvMatrix,
        shellUiEnabled: isShellUIEnabled(),
      })
      const connectId = `ipc-${account.id}-${Date.now()}`

      try {
        // 任一连接入口开始连接即让位：入口选择器隐藏，露出壳内 Tab。
        if (isShellUIEnabled()) shellModeSet('live')
        if (chromePath) {
          browserManager.setChromePath(chromePath)
        }
        const accountSession = accountManager.createSession(platform, account)

        await accountSession.connect({ headless, storageState, mode })
        return { ok: true }
      } catch (error) {
        // 失败分类（壳 v3 · Wave 1 · P0-1）：
        // 旧实现在这里把一切 attach 失败都当成「降级回退外部浏览器」，
        // 于是用户手动断开/页面被拆这类**正常结束**也被伪装成失败并弹出「已回退外部浏览器」。
        // 现在按判别式分流：aborted 静默，其余真失败只推一条通知。
        const kind = connectionFailureKind(error)
        const reason = connectionFailureReason(error)

        if (kind === 'aborted') {
          // 用户主动断开/重启：不是失败。全程静默——不推通知、不弹 toast。
          logger.info(`连接已中止（connectId=${connectId}，mode=${mode}，platform=${platform}）`)
          accountManager.closeSession(account.id, 'internal')
          return { ok: false, aborted: true, connectId }
        }

        // 结构化日志（计划 §3.2）：connectId / mode / platform / kind / reason 一行齐全
        logger.error(
          `连接失败（connectId=${connectId}，mode=${mode}，platform=${platform}，kind=${kind}，reason=${reason}）`,
          error,
        )
        accountManager.closeSession(account.id, 'internal')

        // 单份通知（计划 §3.2 / P1-3）：失败通知**只由主进程发**。
        // 渲染层不再补一条通用 toast，避免 HUD 与通知层两条文案不一致的重复通知。
        pushNotice({
          variant: 'error',
          description: `${KIND_LABEL[kind] ?? KIND_LABEL.other}（kind=${kind}）：${reason}。可重试壳内连接。`,
        })
        return { ok: false, aborted: false, kind, reason }
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.liveControl.disconnect, async (_, accountId) => {
    try {
      // 用户主动断开 → reason='user'：在途连接归因为 aborted（静默，不打扰用户）
      accountManager.closeSession(accountId, 'user')
      return true
    } catch (error) {
      const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
      logger.error('断开连接失败：', error)
      return false
    }
  })
}

export function setupLiveControlIpcHandlers() {
  setupIpcHandlers()
}
