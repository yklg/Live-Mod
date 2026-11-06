// 壳级通知传输总线（shell-ui-polish v3）
// 职责边界（审查 P1-1）：**只做 transport**——payload 校验 + 未就绪缓冲 + 就绪后按序冲刷；
// 展示态（去重/上限 3/超时/动画）全部归 notice 渲染层 noticeState（UI 状态在 UI 层）。
// 失败模式：非法 payload → 拒绝（日志）；未就绪/目标暂不可达 → 放行+标记（缓冲，cap 20）；
// 缓冲溢出 → 汇总上报（logger.warn 计数）。
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import { validateNoticePayload } from './noticePayload'
import {
  createNoticeQueue,
  enqueueNotice,
  markNoticeQueueReady,
  type NoticeQueueState,
  resetNoticeQueue,
} from './noticeQueue'

const logger = createLogger('ShellNotice')

let queue: NoticeQueueState = createNoticeQueue()

function deliver(payload: NoticePayload): boolean {
  return windowManager.sendTo('notice', IPC_CHANNELS.shell.notice, payload)
}

/** renderer 请求 / 主进程事件统一入口。返回是否被接受（非法 payload 拒绝）。 */
export function pushNotice(input: unknown): boolean {
  const result = validateNoticePayload(input)
  if (!result.ok) {
    logger.warn('通知 payload 被拒绝：', result.reason)
    return false
  }
  if (queue.ready && deliver(result.payload)) return true
  queue = enqueueNotice(queue, result.payload)
  if (queue.dropped > 0 && queue.dropped % 5 === 1) {
    logger.warn('通知缓冲溢出，累计丢弃：', queue.dropped)
  }
  return true
}

/** notice 渲染层就绪握手：冲刷缓冲（重复调用幂等，flush 为空） */
export function handleNoticeReady(): void {
  const { state, flush } = markNoticeQueueReady(queue)
  queue = state
  for (const payload of flush) {
    if (!deliver(payload)) {
      logger.warn('通知冲刷失败（notice 目标不可达），本条丢弃')
    }
  }
  if (flush.length > 0) logger.info('通知缓冲已冲刷：', flush.length)
}

export function resetNoticeBus(): void {
  queue = resetNoticeQueue()
}

/** 调试/测试只读快照（E2E 通过 shellDebug 观察未就绪/丢弃计数） */
export function getNoticeBusState(): NoticeQueueState {
  return { ...queue, pending: [...queue.pending] }
}
