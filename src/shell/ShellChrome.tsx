// 壳顶栏两段（Tab 行 40 / 工具行 48，总高 = 主进程 CHROME_H=88）
// 数据流：主进程 tabManager → shell:tabsState 推送 + shell:tabsList 首帧拉取；操作全部 invoke。
// 本组件运行于 chromeView 最小树：只监听 shell:* 通道，零业务事件（A1 铁律）。

import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize,
  Minus,
  Plus,
  RotateCw,
  Sparkles,
  Tv,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShellTabsState } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

const GITHUB_URL = 'https://github.com/yklg/Live-Mod'
const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent)
const DRAG_THRESHOLD = 5

export default function ShellChrome() {
  const [state, setState] = useState<ShellTabsState>({ tabs: [], activeId: 0 })
  const [address, setAddress] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: number; startX: number; started: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  const call = useCallback(
    (ch: keyof typeof IPC_CHANNELS.shell, ...args: unknown[]) =>
      void (
        window.ipcRenderer as unknown as { invoke: (c: string, ...a: unknown[]) => unknown }
      ).invoke(IPC_CHANNELS.shell[ch], ...args),
    [],
  )

  useEffect(() => {
    void (async () => {
      try {
        setState(await window.ipcRenderer.invoke(IPC_CHANNELS.shell.tabsList))
      } catch {
        // 壳未就绪（容器初始化中/异常）：静默，顶栏保持空态
      }
    })()
    return window.ipcRenderer.on(IPC_CHANNELS.shell.tabsState, s => setState(s))
  }, [])

  useEffect(() => {
    return window.ipcRenderer.on(IPC_CHANNELS.shell.assistantState, open => setAssistantOpen(open))
  }, [])

  const active = state.tabs.find(t => t.id === state.activeId)
  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(active?.url ?? '')
  }, [active?.url])

  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${state.activeId}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [state.activeId])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const distance = Math.abs(e.clientX - drag.startX)
      if (!drag.started) {
        if (distance < DRAG_THRESHOLD) return
        drag.started = true
      }
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>('[data-tab-id]')
      setDragOverId(el ? Number(el.dataset.tabId) : null)
    }
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      setDragId(null)
      setDragOverId(null)
      if (!drag?.started) return
      const tabEls = [...(tabsRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])]
      const from = tabEls.findIndex(el => Number(el.dataset.tabId) === drag.id)
      let insert = tabEls.findIndex(el => {
        const r = el.getBoundingClientRect()
        return e.clientX < r.left + r.width / 2
      })
      if (insert < 0) insert = tabEls.length
      if (from >= 0 && from < insert) insert -= 1
      if (insert !== from) call('tabMove', drag.id, insert)
      suppressClickRef.current = true
      setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [call])

  const closeOthers = (id: number) =>
    call(
      'tabCloseBatch',
      state.tabs.filter(t => t.id !== id).map(t => t.id),
    )

  const closeRight = (index: number) =>
    call(
      'tabCloseBatch',
      state.tabs.slice(index + 1).map(t => t.id),
    )

  return (
    <div className="flex h-screen flex-col bg-muted text-foreground select-none">
      {/* Tab 行 40px */}
      <div
        className="flex h-10 items-center gap-1 px-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {isMac && <span className="w-16 shrink-0" />}
        <span className="ml-1 mr-2 shrink-0 text-xs font-medium opacity-60">Live Mod</span>
        <div
          ref={tabsRef}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onWheel={e => {
            if (tabsRef.current) tabsRef.current.scrollLeft += e.deltaY
          }}
        >
          {state.tabs.map((tab, index) => (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  data-tab-id={tab.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={tab.active}
                  onPointerDown={e => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
                    dragRef.current = { id: tab.id, startX: e.clientX, started: false }
                    setDragId(tab.id)
                  }}
                  onClick={() => {
                    if (suppressClickRef.current) return
                    call('tabActivate', tab.id)
                  }}
                  onAuxClick={e => {
                    if (e.button !== 1) return
                    e.preventDefault()
                    call('tabClose', tab.id)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') call('tabActivate', tab.id)
                  }}
                  className={`group flex h-7 max-w-44 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border px-3 text-xs ${
                    tab.active
                      ? 'border-border bg-background font-medium'
                      : 'border-transparent opacity-70 hover:bg-background/50'
                  } ${dragId === tab.id ? 'opacity-40' : ''} ${
                    dragOverId === tab.id && dragId !== tab.id ? 'border-primary' : ''
                  }`}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={tab.title || tab.url}
                >
                  {tab.loading ? (
                    <RotateCw className="size-3 animate-spin shrink-0" />
                  ) : (
                    <Tv className="size-3 shrink-0 opacity-50" />
                  )}
                  <span className="truncate">{tab.title || tab.url || '新标签页'}</span>
                  <button
                    type="button"
                    className={`rounded p-0.5 hover:bg-muted ${
                      tab.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={e => {
                      e.stopPropagation()
                      call('tabClose', tab.id)
                    }}
                    aria-label="关闭标签页"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onSelect={() => call('tabClose', tab.id)}>
                  关闭标签页
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={state.tabs.length <= 1}
                  onSelect={() => closeOthers(tab.id)}
                >
                  关闭其他标签页
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index >= state.tabs.length - 1}
                  onSelect={() => closeRight(index)}
                >
                  关闭右侧标签页
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => call('tabReopen')}>
                  重开已关闭的标签页
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    if (tab.url) void navigator.clipboard?.writeText(tab.url)
                  }}
                >
                  复制链接
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-1 hover:bg-background/60"
          onClick={() => call('tabCreate', {})}
          aria-label="新标签页"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Plus className="size-4" />
        </button>
        <span className="shrink-0" />
        {!isMac && (
          <div
            className="flex shrink-0 items-center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              className="p-2 hover:bg-background/60"
              onClick={() => call('windowMinimize')}
              aria-label="最小化"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              className="p-2 hover:bg-background/60"
              onClick={() => call('windowMaximize')}
              aria-label="最大化"
            >
              <Maximize className="size-3" />
            </button>
            <button
              type="button"
              className="p-2 hover:bg-destructive/80 hover:text-destructive-foreground"
              onClick={() => call('windowClose')}
              aria-label="关闭"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 工具行 48px：导航 + 地址栏 + 壳入口 */}
      <div className="flex h-12 items-center gap-1 border-b border-border bg-background/60 px-2">
        <button
          type="button"
          className="rounded p-1.5 hover:bg-muted disabled:opacity-30"
          disabled={!active?.canBack}
          onClick={() => active && call('tabBack', active.id)}
          aria-label="后退"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          className="rounded p-1.5 hover:bg-muted disabled:opacity-30"
          disabled={!active?.canForward}
          onClick={() => active && call('tabForward', active.id)}
          aria-label="前进"
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="rounded p-1.5 hover:bg-muted"
          onClick={() => active && call('tabReload', active.id)}
          aria-label="刷新"
        >
          <RotateCw className={`size-4 ${active?.loading ? 'animate-spin' : ''}`} />
        </button>
        <input
          ref={addressRef}
          value={address}
          onChange={e => setAddress(e.target.value)}
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            if (e.key === 'Enter' && active) {
              const raw = address.trim()
              if (!raw) return
              const url = /^https?:\/\//i.test(raw)
                ? raw
                : /^[^.]+\.[^.]+/.test(raw.split('/')[0])
                  ? `https://${raw}`
                  : `https://www.baidu.com/s?wd=${encodeURIComponent(raw)}`
              call('tabNavigate', active.id, url)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-full border border-border bg-muted px-3 text-xs outline-none focus:border-primary"
          placeholder="搜索或输入网址"
        />
        <div
          className="ml-1 flex shrink-0 items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            className={`rounded p-1.5 ${
              assistantOpen
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            title="AI 助手（⌘J）"
            aria-label="AI 助手"
            onClick={() => call('assistantToggle')}
          >
            <Sparkles className="size-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="项目主页"
            onClick={() => call('tabCreate', { url: GITHUB_URL })}
          >
            <ExternalLink className="size-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="使用教程"
            onClick={() =>
              void window.ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, GITHUB_URL)
            }
          >
            <BookOpen className="size-4" />
          </button>
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => call('railToggle', 'popup')}
          >
            <Tv className="size-3.5" /> 展开 Live Mod
          </button>
        </div>
      </div>
    </div>
  )
}
