// 壳顶栏（第二期）：52px 产品顶栏 + 36px 浏览器工具条 + 36px 标签行（仅自由浏览）。
// 数据流：主进程 tabManager → shell:tabsState；shellMode → shell:modeState。
// chromeView 是最小树：只监听 shell:* 通道，零业务事件。
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShellTabsState } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useShellMode } from '@/hooks/useShellMode'

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
  const mode = useShellMode(s => s.mode)

  useEffect(() => {
    void (async () => {
      try {
        setState(await window.ipcRenderer.invoke(IPC_CHANNELS.shell.tabsList))
      } catch {
        // 壳未就绪：保持空态
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

  const call = useCallback(
    (ch: keyof typeof IPC_CHANNELS.shell, ...args: unknown[]) =>
      void (
        window.ipcRenderer as unknown as { invoke: (c: string, ...a: unknown[]) => unknown }
      ).invoke(IPC_CHANNELS.shell[ch], ...args),
    [],
  )

  const menuOpen = useShellMode(s => s.menuOpen)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)

  // 菜单失焦收起：菜单本体在 rail 视图，点击官方页由主进程 focus 兜住；
  // 顶栏内部的点击不会改变焦点（主进程收不到 focus），在这里补齐「点其它区域收起」。
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (menuTriggerRef.current?.contains(e.target as Node)) return
      call('railMenuToggle')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [menuOpen, call])

  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${state.activeId}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [state.activeId])

  // 标签轴合并（壳 v3）：账号 Tab 也是标签行的一部分（固定第一张，不可关闭）。
  const visibleTabs = useMemo(() => state.tabs, [state.tabs])
  const isBrowse = mode === 'browse'
  const isEntry = mode === 'entry'

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
      let insert = tabEls.length
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect()
        if (e.clientX < rect.left + rect.width / 2) {
          insert = i
          break
        }
      }
      const targetVisible = visibleTabs[insert]
      if (!targetVisible) {
        call('tabMove', drag.id, state.tabs.length - 1)
      } else {
        const actual = state.tabs.findIndex(t => t.id === targetVisible.id)
        if (actual >= 0) call('tabMove', drag.id, actual)
      }
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
  }, [call, state.tabs, visibleTabs])

  // 账号 Tab 是固定卡：批量关闭必须排除它（否则会把中控台一起关掉）。
  const closeOthers = (id: number) =>
    call(
      'tabCloseBatch',
      visibleTabs.filter(t => t.id !== id && t.kind !== 'account').map(t => t.id),
    )
  const closeRight = (index: number) =>
    call(
      'tabCloseBatch',
      visibleTabs
        .slice(index + 1)
        .filter(t => t.kind !== 'account')
        .map(t => t.id),
    )

  return (
    <div className="flex h-screen flex-col bg-muted text-foreground select-none">
      {/* 产品顶栏 52px */}
      <div
        className="flex h-[52px] shrink-0 items-center gap-2 px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {isMac && <span className="w-16 shrink-0" />}
        <span className="grid size-6 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span className="text-xs font-semibold">Live Mod</span>
        <span className="mx-1 text-border">/</span>
        <span className="text-xs text-muted-foreground">
          {isEntry ? '选择平台' : isBrowse ? '自由浏览' : '直播中控'}
        </span>
        {!isEntry && active?.title && (
          <span className="truncate text-xs text-muted-foreground/70">· {active.title}</span>
        )}
        <span className="flex-1" />
        <div
          className="flex items-center gap-0.5"
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
            onClick={() => {
              call('modeSet', 'browse')
              call('tabCreate', { url: GITHUB_URL })
            }}
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
            ref={menuTriggerRef}
            type="button"
            data-menu-trigger
            className="ml-1 flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => call('railMenuToggle')}
            title="展开 Live Mod 功能菜单"
          >
            <Tv className="size-3.5" /> 展开 Live Mod
          </button>
          {!isMac && (
            <div className="ml-1 flex items-center">
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
      </div>

      {/* 浏览器工具条 36px（entry 不渲染） */}
      {!isEntry && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-y border-border bg-background/60 px-2">
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
        </div>
      )}

      {/* 标签行 36px（非 entry 常显：账号 Tab 是固定第一张卡，中控台不再是独立模式） */}
      {!isEntry && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted px-2">
          <div
            ref={tabsRef}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onWheel={e => {
              if (tabsRef.current) tabsRef.current.scrollLeft += e.deltaY
            }}
          >
            {visibleTabs.map((tab, index) => (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    data-tab-id={tab.id}
                    role="tab"
                    tabIndex={0}
                    aria-selected={tab.active}
                    onPointerDown={e => {
                      // 账号 Tab 固定第一张：不可拖动。
                      if (tab.kind === 'account') return
                      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
                      dragRef.current = { id: tab.id, startX: e.clientX, started: false }
                      setDragId(tab.id)
                    }}
                    onClick={() => {
                      if (suppressClickRef.current) return
                      call('tabActivate', tab.id)
                    }}
                    onAuxClick={e => {
                      if (e.button !== 1 || tab.kind === 'account') return
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
                    {tab.kind !== 'account' && (
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
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    disabled={tab.kind === 'account'}
                    onSelect={() => call('tabClose', tab.id)}
                  >
                    关闭标签页
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={visibleTabs.length <= 1}
                    onSelect={() => closeOthers(tab.id)}
                  >
                    关闭其他标签页
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index >= visibleTabs.length - 1}
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
        </div>
      )}
    </div>
  )
}
