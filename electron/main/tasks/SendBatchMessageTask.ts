import { Result } from '@praha/byethrow'
import type { ScopedLogger } from '#/logger'
import type { CommentSendResult } from '#/services/commentBackend/contracts'
import { insertRandomSpaces, randomInt, replaceVariant, sleep } from '#/utils'
import type { IPerformComment } from './../platforms/IPlatform'
import { createTask } from './BaseTask'
import { TaskStopReason } from './ITask'

const TASK_NAME = '一键评论'

export interface BatchCommentSender {
  sendReply: (text: string) => Promise<CommentSendResult>
}

export function createSendBatchMessageTask(
  platform: IPerformComment,
  config: SendBatchMessagesConfig,
  _logger: ScopedLogger,
  sender?: BatchCommentSender,
) {
  const logger = _logger.scope(TASK_NAME)

  async function execute() {
    try {
      const { messages, count } = config
      for (let i = 0; i < count; i++) {
        if (!task.isRunning()) {
          break
        }
        const messageIndex = randomInt(0, messages.length - 1)
        let message = replaceVariant(messages[messageIndex])
        if (!config.noSpace) {
          message = insertRandomSpaces(message)
        }

        if (sender) {
          // B2：发送走 headless 真实 Chrome 后端（壳内页发送被平台风控）
          const sent = await sender.sendReply(message)
          if (!sent.ok) {
            return task.stop(TaskStopReason.ERROR, new Error(sent.error ?? '发送失败'))
          }
        } else {
          const result = await platform.performComment(message)
          if (Result.isFailure(result)) {
            return task.stop(TaskStopReason.ERROR, result.error)
          }
        }
        logger.success(`成功发送第 ${i + 1}/${count} 条评论：${message}`)
        // 以防万一，加一个 1s 的小停顿
        await sleep(1000)
      }
      task.stop(TaskStopReason.COMPLETED)
    } catch (error) {
      task.stop(TaskStopReason.ERROR, error)
    }
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
    },
  )

  return Result.succeed({
    ...task,
  })
}
