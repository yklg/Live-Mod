// 壳级通知覆盖层渲染（shell-ui-polish v3 · 最小树）
// 数据流：主进程 noticeBus → shell:notice push → 本组件 reducer（去重/上限/超时）→ 渲染。
// 点击穿透由承载窗口（BrowserWindow.setIgnoreMouseEvents）保证；本层 pointer-events-none 只做展示。
import { useEffect, useReducer } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { NOTICE } from '@/constants'
import { cn } from '@/lib/utils'
import { initialNoticeState, type NoticeItem, noticeReducer } from './lib/noticeState'

const ACCENT: Record<NoticeVariant, string> = {
  success: 'border-l-success',
  error: 'border-l-destructive',
  warning: 'border-l-warning',
  info: 'border-l-info',
}

const DOT: Record<NoticeVariant, string> = {
  success: 'bg-success',
  error: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-info',
}

function NoticeCard({ item, onExpire }: { item: NoticeItem; onExpire: (id: number) => void }) {
  useEffect(() => {
    const testOverride = typeof window !== 'undefined' ? window.__lmNoticeTestMs : undefined
    const duration = testOverride ?? NOTICE.DURATION_MS[item.variant]
    const timer = setTimeout(() => onExpire(item.id), duration)
    return () => clearTimeout(timer)
  }, [item.id, item.variant, onExpire])

  return (
    <div
      data-notice-item
      data-variant={item.variant}
      className={cn(
        'w-[380px] overflow-hidden rounded-lg border border-l-4 border-border bg-background p-4 shadow-lg',
        ACCENT[item.variant],
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[item.variant])} />
        <div className="min-w-0">
          {item.title && <p className="text-sm font-medium text-foreground">{item.title}</p>}
          <p className="break-words text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        </div>
      </div>
    </div>
  )
}

export function NoticeHost() {
  const [state, dispatch] = useReducer(noticeReducer, initialNoticeState)

  useEffect(() => {
    const off = window.ipcRenderer.on(IPC_CHANNELS.shell.notice, payload => {
      dispatch({ type: 'push', payload, now: Date.now() })
    })
    // 就绪握手：主进程冲刷未就绪缓冲
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.noticeReady).catch(() => {})
    return off
  }, [])

  const handleExpire = (id: number) => dispatch({ type: 'expire', id })

  // 常驻 live region（即使 0 条通知也在 DOM —— 屏幕阅读器不丢播报；外部经验 EX-C）
  return (
    <div
      data-testid="notice-root"
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex flex-col items-end gap-2 p-4"
    >
      {state.items.map(item => (
        <NoticeCard key={item.id} item={item} onExpire={handleExpire} />
      ))}
    </div>
  )
}
