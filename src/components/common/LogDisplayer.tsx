import { useMemoizedFn } from 'ahooks'
import type { LogMessage } from 'electron-log'
import { ChevronDown, ChevronUp, PanelBottom } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { useIpcListener } from '@/hooks/useIpc'
import { cn } from '@/lib/utils'

export interface ParsedLog {
  id: string
  timestamp: string
  module: string
  level: string
  message: string
}

/** 纯函数：electron-log 消息 → 展示用日志条目（提升到模块作用域以便单测，行为与原组件内实现一致） */
export const parseLogMessage = (log: LogMessage): ParsedLog | null => {
  if (!log.data || log.data.length === 0) {
    return null
  }
  return {
    id: crypto.randomUUID(),
    timestamp: log.date.toLocaleString(),
    module: log.scope ?? 'App',
    level: typeof log.level === 'string' ? log.level.toUpperCase() : 'INFO',
    // 只保留换行符之前的内容
    message: log.data.map(String).join(' ').split('\n')[0],
  }
}

// 日志面板折叠状态（log-panel-storage 已注册进 STORAGE_KEYS 白名单）
interface LogPanelState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

const useLogPanelStore = create<LogPanelState>()(
  persist(set => ({ collapsed: false, setCollapsed: collapsed => set({ collapsed }) }), {
    name: 'log-panel-storage',
    version: 1,
    storage: createJSONStorage(() => localStorage),
  }),
)

const MAX_LOG_MESSAGES = 200 // 仅展示最近的 200 条日志

function levelClass(level: string): string {
  switch (level) {
    case 'ERROR':
      return 'text-destructive font-medium'
    case 'FATAL':
      return 'text-destructive font-bold'
    case 'WARN':
      return 'text-warning font-medium'
    case 'DEBUG':
      return 'text-info'
    case 'SUCCESS':
      return 'text-success'
    case 'NOTE':
      return 'text-note'
    default:
      return 'text-muted-foreground'
  }
}

export default function LogDisplayer() {
  const [logMessages, setLogMessages] = useState<ParsedLog[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const collapsed = useLogPanelStore(s => s.collapsed)
  const setCollapsed = useLogPanelStore(s => s.setCollapsed)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    if (viewportRef.current && autoScroll) {
      const scrollContainer = viewportRef.current
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      })
    }
  }, [autoScroll])

  useEffect(() => {
    // 监听 ScrollArea 的 viewport 元素
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector<HTMLDivElement>(
        '[data-radix-scroll-area-viewport]',
      )
      if (viewport) {
        // 使用 MutableRefObject 来避免只读属性错误
        viewportRef.current = viewport
      }
    }
  }, [])

  const handleLogMessage = useCallback(
    (message: LogMessage) => {
      const parsed = parseLogMessage(message)
      if (parsed) {
        setLogMessages(prev => [...prev.slice(-MAX_LOG_MESSAGES + 1), parsed])
        if (autoScroll) {
          scrollToBottom()
        }
      }
    },
    [autoScroll, scrollToBottom],
  )

  useIpcListener(IPC_CHANNELS.log, handleLogMessage)

  const autoScrollId = useId()
  const warnCount = logMessages.filter(log => log.level === 'WARN').length
  const errorCount = logMessages.filter(
    log => log.level === 'ERROR' || log.level === 'FATAL',
  ).length
  const lastLog = logMessages[logMessages.length - 1]

  // ===== 折叠态：36px 状态条 =====
  if (collapsed) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-label="展开运行日志"
        onClick={() => setCollapsed(false)}
        className="flex h-9 w-full min-w-0 shrink-0 items-center gap-2.5 overflow-hidden border-t bg-card px-3.5 text-left text-xs transition-colors hover:bg-accent/50"
      >
        <PanelBottom className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold text-foreground">运行日志</span>
        <span className="text-muted-foreground">{logMessages.length} 条</span>
        {warnCount > 0 && (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold text-warning">
            WARN {warnCount}
          </span>
        )}
        {errorCount > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold text-destructive">
            ERROR {errorCount}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {lastLog ? `${lastLog.timestamp} [${lastLog.module}] ${lastLog.message}` : '暂无日志'}
        </span>
        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    )
  }

  // ===== 展开态 =====
  return (
    <div className="flex h-[220px] min-w-0 shrink-0 flex-col overflow-hidden border-t bg-card">
      {/* 日志头部 */}
      <div className="flex items-center justify-between border-b px-4 py-1.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold">运行日志</h3>
          <span className="text-xs text-muted-foreground">{logMessages.length} 条记录</span>
        </div>
        <div className="flex items-center gap-4">
          {/* 自动滚动开关 */}
          <div className="flex items-center gap-2">
            <Switch id={autoScrollId} checked={autoScroll} onCheckedChange={setAutoScroll} />
            <label
              htmlFor={autoScrollId}
              className="cursor-pointer select-none text-xs text-muted-foreground"
            >
              自动滚动
            </label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLogMessages([])
              scrollToBottom()
            }}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            清空
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="折叠运行日志"
            onClick={() => setCollapsed(true)}
            className="h-7 w-7 text-muted-foreground"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 日志内容 */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className="p-4 font-mono text-sm">
          {logMessages.map((log, index) => (
            <LogItem key={log.id} log={log} index={index} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

function LogItem({ log, index }: { log: ParsedLog; index: number }) {
  const getLevelColor = useMemoizedFn((level: string): string => levelClass(level))
  return (
    <div
      className={cn(
        'flex gap-2 items-start py-1 whitespace-nowrap',
        index % 2 === 0 ? 'bg-muted/40' : 'bg-card',
      )}
    >
      <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
      <span className="text-foreground/70 shrink-0">[{log.module}]</span>
      <span className={cn('shrink-0', getLevelColor(log.level))}>{log.level}</span>
      <span className="text-foreground truncate">{log.message}</span>
    </div>
  )
}
