// 最近直播场次共享契约（主进程 LiveHistoryStore ↔ workspace 首页）
export type LiveSessionStatus = 'live' | 'ended' | 'interrupted'

export interface LiveSession {
  id: string
  accountId: string
  platform: string
  startedAt: number
  endedAt: number | null
  status: LiveSessionStatus
}

export interface LiveHistorySnapshot {
  sessions: LiveSession[]
}
