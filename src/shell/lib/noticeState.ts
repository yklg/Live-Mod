// 通知展示态 reducer（纯函数，shell-ui-polish v3 · 展示态归 UI 层）
// 职责：去重（同 variant+description 短窗口）/ 上限（NOTICE.LIMIT，超出淘汰最旧）/ 超时移除 / 清空。
// 传输与未就绪缓冲在主进程 noticeBus；本模块零 Electron/零 IPC，便于单测。
import { NOTICE } from '@/constants'

export interface NoticeItem {
  id: number
  variant: NoticeVariant
  title?: string
  description: string
  createdAt: number
}

export interface NoticeState {
  items: NoticeItem[]
  seq: number
  /** 因上限淘汰的累计条数（可观测计数） */
  dropped: number
}

export const initialNoticeState: NoticeState = { items: [], seq: 0, dropped: 0 }

export type NoticeAction =
  | { type: 'push'; payload: NoticePayload; now: number }
  | { type: 'expire'; id: number }
  | { type: 'clear' }

export function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case 'push': {
      const { payload, now } = action
      const duplicated = state.items.some(
        item =>
          item.variant === payload.variant &&
          item.description === payload.description &&
          now - item.createdAt < NOTICE.DEDUPE_MS,
      )
      if (duplicated) return state
      const id = state.seq + 1
      const item: NoticeItem = {
        id,
        variant: payload.variant,
        description: payload.description,
        createdAt: now,
        ...(payload.title ? { title: payload.title } : {}),
      }
      const all = [item, ...state.items]
      const items = all.slice(0, NOTICE.LIMIT)
      return { items, seq: id, dropped: state.dropped + (all.length - items.length) }
    }
    case 'expire':
      return { ...state, items: state.items.filter(item => item.id !== action.id) }
    case 'clear':
      return { ...initialNoticeState }
    default:
      return state
  }
}
