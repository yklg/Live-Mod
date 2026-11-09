// 壳顶栏三段（Tab 行 40 / 工具行 44 / 快捷条 36，总高 = 主进程 CHROME_H=120）
// 数据流：主进程 tabManager → shell:tabsState 推送 + shell:tabsList 首帧拉取；操作全部 invoke。
// 本组件运行于 chromeView 最小树：只监听 shell:* 通道，零业务事件（A1 铁律）。

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize,
  Minus,
  Plus,
  RotateCw,
  Tv,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ShellTabsState } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'

const GITHUB_URL = 'https://github.com/yklg/Live-Mod'
const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent)

export default function ShellChrome() {
  const [state, setState] = useState<ShellTabsState>({ tabs: [], activeId: 0 })
  const [address, setAddress] = useState('')
  const addressRef = useRef<HTMLInputElement>(null)

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

  const active = state.tabs.find(t => t.id === state.activeId)
  useEffect(() => {
    if (document.activeElement !== addressRef.current) setAddress(active?.url ?? '')
  }, [active?.url])

  const call = (ch: keyof typeof IPC_CHANNELS.shell, ...args: unknown[]) =>
    void (
      window.ipcRenderer as unknown as { invoke: (c: string, ...a: unknown[]) => unknown }
    ).invoke(IPC_CHANNELS.shell[ch], ...args)

  return (
    <div className="flex h-screen flex-col bg-muted text-foreground select-none">
      {/* Tab 行 */}
      <div
        className="flex h-10 items-center gap-1 px-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {isMac && <span className="w-16 shrink-0" />}
        <span className="ml-1 mr-2 text-xs font-medium opacity-60">Live Mod</span>
        {state.tabs.map(tab => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={tab.active}
            onClick={() => call('tabActivate', tab.id)}
            onKeyDown={e => {
              if (e.key === 'Enter') call('tabActivate', tab.id)
            }}
            className={`group flex h-7 max-w-44 min-w-0 cursor-pointer items-center gap-1.5 rounded-t-md border px-3 text-xs ${
              tab.active
                ? 'border-border bg-background font-medium'
                : 'border-transparent opacity-70 hover:bg-background/50'
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
              className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
              onClick={e => {
                e.stopPropagation()
                call('tabClose', tab.id)
              }}
              aria-label="关闭标签页"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded p-1 hover:bg-background/60"
          onClick={() => call('tabCreate', {})}
          aria-label="新标签页"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Plus className="size-4" />
        </button>
        <span className="flex-1" />
        {!isMac && (
          <div
            className="flex items-center"
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

      {/* 工具行：后退/前进/刷新 + 地址栏 */}
      <div className="flex h-11 items-center gap-1 border-b border-border bg-background/60 px-2">
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
          className="h-7 flex-1 rounded-full border border-border bg-muted px-3 text-xs outline-none focus:border-primary"
          placeholder="搜索或输入网址"
        />
      </div>

      {/* 快捷入口条（对标光圈书签条） */}
      <div className="flex h-9 items-center gap-2 border-b border-border bg-background px-2 text-xs">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted"
          onClick={() => call('tabCreate', { url: GITHUB_URL })}
        >
          <ExternalLink className="size-3.5" /> 项目主页
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted"
          onClick={() => void window.ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, GITHUB_URL)}
        >
          使用教程
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => call('railToggle', 'popup')}
        >
          <Tv className="size-3.5" /> 展开 Live Mod
        </button>
      </div>
    </div>
  )
}
