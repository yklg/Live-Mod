import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { ScopedLogger } from '#/logger'
import type { ICommentListener } from '#/platforms/IPlatform'
import { WebSocketService } from '#/services/WebSocketService'
import windowManager from '#/windowManager'
import { createTask } from './BaseTask'
import { TaskStopReason } from './ITask'

const TASK_NAME = '自动回复'

/** B2 读链路适配：任务只依赖"订阅评论流"，不感知后端实现 */
export interface CommentSourceAdapter {
  subscribe: (onComment: (message: LiveMessage) => void) => () => void
}

export function createCommentListenerTask(
  platform: ICommentListener,
  config: CommentListenerConfig,
  account: Account,
  _logger: ScopedLogger,
  source?: CommentSourceAdapter,
) {
  const logger = _logger.scope(TASK_NAME)
  let wsService: WebSocketService | null
  let unsubscribeSource: (() => void) | null = null
  let usingPlatformSource = false

  async function execute() {
    try {
      if (config.ws) {
        wsService = new WebSocketService()
        // WebSocket 服务启动失败不会影响评论监听
        wsService.start(config.ws.port).catch(err => {
          wsService?.stop(err)
          wsService = null
        })
      }
      if (source) {
        unsubscribeSource = source.subscribe(broadcastMessage)
        logger.info('开始监听评论（B2 真实 Chrome 后端）')
      } else {
        await platform.startCommentListener(broadcastMessage, config.source)
        usingPlatformSource = true
        logger.info('开始监听评论')
      }
    } catch (err) {
      // 失败了还要告诉渲染层关闭按钮
      windowManager.send(IPC_CHANNELS.tasks.autoReply.listenerStopped, account.id)
      task.stop(TaskStopReason.ERROR, err)
    }
  }

  function broadcastMessage(message: LiveMessage) {
    const comment: LiveMessage = {
      ...message,
      time: Date.now(),
    }
    windowManager.send(IPC_CHANNELS.tasks.autoReply.showComment, {
      accountId: account.id,
      comment: comment,
    })

    wsService?.broadcast(comment)
  }

  function updateConfig(cfg: Partial<CommentListenerConfig>) {
    if (cfg.ws && cfg.ws.port !== config.ws?.port) {
      config.ws = cfg.ws
      if (!wsService) {
        wsService = new WebSocketService()
      }
      wsService.stop()
      wsService.start(config.ws.port).catch(err => {
        wsService?.stop(err)
        wsService = null
      })
    }
    if (cfg.source && config.source !== cfg.source) {
      config.source = cfg.source
      if (source) {
        unsubscribeSource?.()
        unsubscribeSource = source.subscribe(broadcastMessage)
      } else {
        platform.stopCommentListener()
        platform.startCommentListener(broadcastMessage, cfg.source)
      }
    }
    return Result.succeed()
  }

  const task = createTask(
    {
      taskName: TASK_NAME,
      logger,
    },
    {
      onStart: async () => {
        await execute()
      },
      onStop: () => {
        unsubscribeSource?.()
        unsubscribeSource = null
        if (usingPlatformSource) platform.stopCommentListener()
        usingPlatformSource = false
        wsService?.stop()
        wsService = null
      },
    },
  )

  return Result.succeed({
    ...task,
    updateConfig,
  })
}
