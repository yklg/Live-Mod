// 壳内「直播互动」面板：展示 B2 后端（headless 真实 Chrome）读取的评论流。
// 发送能力在 Stage 3 接入（backend.sendReply），当前先以只读面板交付读链路。
import { MessageCircle, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { type CommentItem, mergeComments } from './LiveInteraction/lib/mergeComments'

interface BackendStatus {
  state: 'idle' | 'starting' | 'live' | 'degraded' | 'stopped' | 'error'
  comments: number
  lastCommentAt?: number
  lastFreshAt?: number
  degradedReason?: 'no-data' | 'poll-miss'
  error?: string
}

const STATE_TEXT: Record<BackendStatus['state'], string> = {
  idle: '未启动',
  starting: '连接中…',
  live: '已连接',
  degraded: '可能失效',
  stopped: '已停止',
  error: '异常',
}

const STATE_CLASS: Record<BackendStatus['state'], string> = {
  idle: 'bg-muted text-muted-foreground',
  starting: 'bg-warning/10 text-warning',
  live: 'bg-success/10 text-success',
  degraded: 'bg-warning/10 text-warning',
  stopped: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function LiveInteraction() {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [statuses, setStatuses] = useState<Record<string, BackendStatus>>({})
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [debugAvailable, setDebugAvailable] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    // 时序铁律：**先注册监听，再取快照**。反过来会漏掉两者之间的推送；
    // 重叠部分由 mergeComments 用 (accountId,id) 复合键消掉。
    const offComment = window.ipcRenderer.on(IPC_CHANNELS.tasks.commentBackend.comment, payload => {
      const item: CommentItem = { ...payload.comment, accountId: payload.accountId }
      setComments(prev => mergeComments(prev, [item]))
    })
    const offStatus = window.ipcRenderer.on(IPC_CHANNELS.tasks.commentBackend.status, payload => {
      setStatuses(prev => ({ ...prev, [payload.accountId]: payload.status }))
    })

    void window.ipcRenderer
      .invoke(IPC_CHANNELS.tasks.commentBackend.getState)
      .then(result => {
        const map: Record<string, BackendStatus> = {}
        const fromSnapshot: CommentItem[] = []
        for (const entry of result.accounts) {
          map[entry.accountId] = entry.status
          for (const c of entry.comments) fromSnapshot.push({ ...c, accountId: entry.accountId })
        }
        setStatuses(map)
        if (fromSnapshot.length > 0) setComments(prev => mergeComments(prev, fromSnapshot))
        setSnapshotError(null)
        setDebugAvailable(result.debug === true)
      })
      .catch((e: unknown) => {
        // 不再静默吞错：dev 下 IPC 门禁失败曾表现为"永远未连接"，无任何线索
        setSnapshotError(String(e).slice(0, 160))
      })

    return () => {
      offComment()
      offStatus()
    }
  }, [])

  const statusList = Object.entries(statuses)
  const currentEntry = statusList[0]
  const current = currentEntry?.[1]
  const total = current?.comments ?? 0
  const accountId = currentEntry?.[0]
  const canSend = Boolean(accountId) && current?.state === 'live' && !sending

  async function handleInject() {
    try {
      const r = await window.__lmCommentDebug?.inject('测试评论')
      if (r && !r.ok) setSnapshotError(r.error ?? '注入失败')
      else setSnapshotError(null)
    } catch (e) {
      setSnapshotError(String(e).slice(0, 160))
    }
  }

  async function handleSend() {
    const content = text.trim()
    if (!content || !accountId || sending) return
    setSending(true)
    setSendError(null)
    try {
      const result = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.commentBackend.send,
        accountId,
        content,
      )
      if (result.ok) setText('')
      else setSendError(result.error ?? '发送失败')
    } catch (e) {
      setSendError(String(e).slice(0, 120))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">直播互动</span>
        {snapshotError && (
          <span className="max-w-72 truncate text-xs text-destructive" title={snapshotError}>
            读取历史失败：{snapshotError}
          </span>
        )}
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
            current ? STATE_CLASS[current.state] : 'bg-muted text-muted-foreground'
          }`}
          title={
            current?.state === 'degraded' && current.degradedReason === 'no-data'
              ? `读链路超过 30 秒没有 comment/info 响应${
                  current.lastFreshAt ? `（最近一次 ${formatTime(current.lastFreshAt)}）` : ''
                }`
              : undefined
          }
        >
          {current ? STATE_TEXT[current.state] : '未连接'}
        </span>
        {debugAvailable && (
          <button
            type="button"
            onClick={handleInject}
            className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            title="仅调试模式可用：注入一条评论，用于验证面板显示与切走回放"
          >
            注入测试评论
          </button>
        )}
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
        <div className="flex gap-2">
          <input
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-muted/40"
            placeholder={
              canSend ? '回复观众或直接发评，Enter 一键发送' : '评论后端未连接，暂不可发送'
            }
            value={text}
            disabled={!canSend}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleSend()
              }
            }}
          />
          <button
            type="button"
            className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSend || text.trim().length === 0}
            onClick={() => void handleSend()}
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
        {sendError && <p className="mt-1.5 text-xs text-destructive">{sendError}</p>}
      </div>
    </div>
  )
}
