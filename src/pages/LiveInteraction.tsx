// 壳内「直播互动」面板：展示 B2 后端（headless 真实 Chrome）读取的评论流。
// 发送能力在 Stage 3 接入（backend.sendReply），当前先以只读面板交付读链路。
import { MessageCircle, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'

interface CommentItem {
  id: string
  nickName: string
  content: string
  at: number
  accountId?: string
}

interface BackendStatus {
  state: 'idle' | 'starting' | 'live' | 'degraded' | 'stopped' | 'error'
  comments: number
  lastCommentAt?: number
  error?: string
}

const STATE_TEXT: Record<BackendStatus['state'], string> = {
  idle: '未启动',
  starting: '连接中…',
  live: '已连接',
  degraded: '降级',
  stopped: '已停止',
  error: '异常',
}

const STATE_CLASS: Record<BackendStatus['state'], string> = {
  idle: 'bg-muted text-muted-foreground',
  starting: 'bg-amber-100 text-amber-700',
  live: 'bg-emerald-100 text-emerald-700',
  degraded: 'bg-amber-100 text-amber-700',
  stopped: 'bg-muted text-muted-foreground',
  error: 'bg-red-100 text-red-700',
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function LiveInteraction() {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [statuses, setStatuses] = useState<Record<string, BackendStatus>>({})

  useEffect(() => {
    const offComment = window.ipcRenderer.on(IPC_CHANNELS.tasks.commentBackend.comment, payload => {
      const item: CommentItem = { ...payload.comment, accountId: payload.accountId }
      setComments(prev => (prev.some(c => c.id === item.id) ? prev : [...prev.slice(-199), item]))
    })
    const offStatus = window.ipcRenderer.on(IPC_CHANNELS.tasks.commentBackend.status, payload => {
      setStatuses(prev => ({ ...prev, [payload.accountId]: payload.status }))
    })
    void window.ipcRenderer
      .invoke(IPC_CHANNELS.tasks.commentBackend.getState)
      .then(result => {
        const map: Record<string, BackendStatus> = {}
        for (const entry of result.accounts) map[entry.accountId] = entry.status
        setStatuses(map)
      })
      .catch(() => {})
    return () => {
      offComment()
      offStatus()
    }
  }, [])

  const statusList = Object.entries(statuses)
  const current = statusList[0]?.[1]
  const total = current?.comments ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">直播互动</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
            current ? STATE_CLASS[current.state] : 'bg-muted text-muted-foreground'
          }`}
        >
          {current ? STATE_TEXT[current.state] : '未连接'}
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <Radio className="size-3" />
        <span>数据源：headless 真实 Chrome（后台）· 已收评论 {total} 条</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {comments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <MessageCircle className="size-8 opacity-40" />
            <span>等待评论数据…</span>
            <span className="opacity-70">开播后评论会自动出现在这里</span>
          </div>
        ) : (
          comments.map(c => (
            <div key={c.id} className="rounded-md px-2 py-1.5 hover:bg-muted/60">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-foreground">{c.nickName || '匿名'}</span>
                <span className="text-[10px] text-muted-foreground">{formatTime(c.at)}</span>
              </div>
              <p className="mt-0.5 break-words text-sm leading-relaxed">{c.content}</p>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3">
        <input
          className="h-9 w-full cursor-not-allowed rounded-md border border-input bg-muted/40 px-3 text-sm"
          placeholder="发送能力将在 Stage 3 接入…"
          disabled
        />
      </div>
    </div>
  )
}
