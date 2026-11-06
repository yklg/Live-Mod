// 通知传输队列（纯 reducer，零 Electron import，shell-ui-polish v3 · EX-A 外部经验）
// 职责边界：主进程只做 transport——未就绪缓冲 + 就绪后按序冲刷 + 上限淘汰；
// 展示态（去重/上限 3/超时）不在此处（归 notice 渲染层 noticeState）。
export const NOTICE_PENDING_CAP = 20

export interface NoticeQueueState {
  ready: boolean
  pending: NoticePayload[]
  /** 累计因上限淘汰的条数（可观测计数，供日志） */
  dropped: number
}

export function createNoticeQueue(): NoticeQueueState {
  return { ready: false, pending: [], dropped: 0 }
}

/** 未就绪时入队（cap 淘汰最旧）；已就绪返回原 state（调用方应直接推送） */
export function enqueueNotice(state: NoticeQueueState, payload: NoticePayload): NoticeQueueState {
  if (state.ready) return state
  const pending = [...state.pending, payload]
  let dropped = state.dropped
  while (pending.length > NOTICE_PENDING_CAP) {
    pending.shift()
    dropped += 1
  }
  return { ...state, pending, dropped }
}

/** 标记就绪：返回待冲刷列表；重复调用幂等（第二次 flush=[]） */
export function markNoticeQueueReady(state: NoticeQueueState): {
  state: NoticeQueueState
  flush: NoticePayload[]
} {
  if (state.ready) return { state, flush: [] }
  return { state: { ready: true, pending: [], dropped: state.dropped }, flush: state.pending }
}

export function resetNoticeQueue(): NoticeQueueState {
  return createNoticeQueue()
}
