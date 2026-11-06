import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { AttachSessionError, browserManager } from '#/managers/BrowserSessionManager'
import { defaultEnvMatrix, resolveConnectMode } from '#/platforms/envMatrix'
import { runtimeEnvState } from '#/platforms/runtimeEnvState'
import { typedIpcMainHandle } from '#/utils'
import windowManager from '#/windowManager'
import { hideEntry } from '#/windows/entryView'
import { isShellUIEnabled } from '#/windows/shellUI'

const TASK_NAME = '中控台'

function setupIpcHandlers() {
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.liveControl.connect,
    async (_, { chromePath, headless, storageState, platform, account, mode: payloadMode }) => {
      const logger = createLogger(`@${account.name}`).scope(TASK_NAME)
      try {
        // 任一连接入口（面板按钮 / 入口意图）开始连接即让位：入口选择器隐藏，露出壳内 Tab
        hideEntry()
        if (chromePath) {
          browserManager.setChromePath(chromePath)
        }
        const accountSession = accountManager.createSession(platform, account)

        // A3 裁决唯一消费点：payload.mode ?? 壳内默认层（v3）?? 运行时降级 ?? 静态矩阵 ?? 'launch'
        const mode = resolveConnectMode({
          payloadMode,
          platform,
          degraded: runtimeEnvState.isDegraded(platform),
          matrix: defaultEnvMatrix,
          shellUiEnabled: isShellUIEnabled(),
        })

        try {
          await accountSession.connect({ headless, storageState, mode })
        } catch (error) {
          // F3：attach 建立失败 → 运行时降级，本次请求内以 launch 重试一次
          if (mode === 'attach') {
            logger.warn(
              'attach 会话建立失败，本次降级为 launch：',
              error instanceof AttachSessionError ? error.reason : error,
            )
            runtimeEnvState.degrade(platform)
            // v3·决策3：降级不静默——rail 明示（经典模式无监听静默丢弃属预期，见计划 Assumptions）
            windowManager.sendTo(
              'ui',
              IPC_CHANNELS.shell.warnToast,
              '壳内连接失败，已回退外部浏览器登录',
            )
            await accountSession.connect({ headless, storageState, mode: 'launch' })
          } else {
            throw error
          }
        }
        return true
      } catch (error) {
        logger.error('连接直播控制台失败：', error)
        accountManager.closeSession(account.id)
        return false
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.liveControl.disconnect, async (_, accountId) => {
    try {
      accountManager.closeSession(accountId)
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
