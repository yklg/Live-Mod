// 右栏图标条 + 800px 功能面板（guangquan-shell-ui-parity v3 · P2 RailPanel）
// 图标映射（Live Mod 功能映射，对标光圈七项右栏）：
//   中控台→LiveControl 连接页 / 自动弹窗 / 自动发言 / 自动回复 / AI 助手 / 设置 / 帮助(外链)
// 开合态（A2）：初始由视口宽度推导（railView bounds 即真源镜像），此后完全跟随 shell:rail:state 推送；
// 本组件不持有开合状态——图标点击/ESC/× 一律发 railToggle 请求给主进程。

import {
  Gift,
  HelpCircle,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Settings,
  Tv,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import type { ShellRailState } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { SHELL_RAIL_ROUTES, SHELL_ROUTES, type ShellRouteId } from 'shared/shellRoutes'
import { useGlobalIpcListener } from '@/App'
import { Toaster } from '@/components/ui/toaster'
import { UpdateDialog } from '@/components/update/UpdateDialog'
import AutoMessage from '@/pages/AutoMessage'
import AutoPopUp from '@/pages/AutoPopUp'
import AutoReply from '@/pages/AutoReply'
import AutoReplySettings from '@/pages/AutoReply/AutoReplySettings'
import LiveControl from '@/pages/LiveControl'
import LiveInteraction from '@/pages/LiveInteraction'
import RedPacket from '@/pages/RedPacket'
import SettingsPage from '@/pages/SettingsPage'

const GITHUB_URL = 'https://github.com/yklg/Live-Mod'

const ROUTE_ICONS: Record<ShellRouteId, React.ComponentType<{ className?: string }>> = {
  live: Tv,
  popup: Gift,
  message: Megaphone,
  reply: MessagesSquare,
  'reply-settings': MessagesSquare,
  interaction: MessageCircle,
  settings: Settings,
  'red-packet': Gift,
}

const ROUTE_ELEMENTS: Record<ShellRouteId, React.ReactNode> = {
  live: <LiveControl />,
  popup: <AutoPopUp />,
  message: <AutoMessage />,
  reply: <AutoReply />,
  'reply-settings': <AutoReplySettings />,
  interaction: <LiveInteraction />,
  settings: <SettingsPage />,
  'red-packet': <RedPacket />,
}

interface RailItem {
  id: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  path?: string
  external?: boolean
}

const ITEMS: RailItem[] = [
  ...SHELL_RAIL_ROUTES.map(route => ({
    id: route.id,
    icon: ROUTE_ICONS[route.id],
    label: route.label,
    path: route.path,
  })),
  { id: 'help', icon: HelpCircle, label: '帮助', external: true },
]

const RAIL_W = 56

function requestToggle(routeId?: string | null) {
  void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railToggle, routeId ?? null)
}

export function ShellRailRoot() {
  // 完整业务树唯一宿主（TC-E2 反向断言目标）：全局事件监听恰好注册一次
  useGlobalIpcListener()
  // 初始态由视口宽度推导（bounds 镜像），此后只信主进程推送（A2 单源）
  const [rail, setRail] = useState<ShellRailState>({
    panelOpen: window.innerWidth > RAIL_W,
    routeId: null,
  })

  useEffect(() => {
    return window.ipcRenderer.on(IPC_CHANNELS.shell.railState, s => setRail(s))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rail.panelOpen) requestToggle(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rail.panelOpen])

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {rail.panelOpen && (
        // biome-ignore lint/a11y/useSemanticElements: 可拖拽分隔条需要指针事件，<hr> 不能承载拖拽交互
        <div
          data-testid="panel-drag-handle"
          role="separator"
          aria-label="调整面板宽度"
          className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
          onPointerDown={e => {
            e.preventDefault()
            void window.ipcRenderer.invoke(
              IPC_CHANNELS.shell.panelDragBegin,
              window.innerWidth,
              e.screenX,
            )
          }}
        />
      )}
      <MemoryRouter initialEntries={[ITEMS.find(i => i.id === rail.routeId)?.path ?? '/']}>
        <ShellRailLayout rail={rail} />
      </MemoryRouter>
      <Toaster />
      <UpdateDialog />
    </div>
  )
}

function ShellRailLayout({ rail }: { rail: ShellRailState }) {
  const navigate = useNavigate()
  const [lastRoute, setLastRoute] = useState<string | null>(null)

  // 跟随推送换页：routeId 变化才 navigate（面板内容由路由决定，开合由主进程决定）
  useEffect(() => {
    if (rail.panelOpen && rail.routeId && rail.routeId !== lastRoute) {
      const item = ITEMS.find(i => i.id === rail.routeId)
      if (item?.path) navigate(item.path)
      setLastRoute(rail.routeId)
    }
  }, [rail, lastRoute, navigate])

  const activeItem = ITEMS.find(i => i.id === rail.routeId)

  return (
    <>
      {rail.panelOpen && (
        <div className="flex min-w-0 flex-1 flex-col border-l border-border">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
            <span className="flex-1 text-sm font-medium">{activeItem?.label ?? '功能面板'}</span>
            {/* 面板是 600px overlay，会盖住官方页面右侧（抖店中控台的评论区/观众列表就在那里）。
                这里明确给出「一键让出右侧」的入口，否则用户会以为官方页面没有评论。 */}
            <span
              className="hidden items-center gap-1 text-[10px] text-muted-foreground xl:flex"
              title="收起面板后即可看到官方页面右侧的评论区"
            >
              <kbd className="rounded border border-border px-1 py-0.5 font-mono">⌘\</kbd>
              <span>让出右侧看网页</span>
            </span>
            <button
              type="button"
              className="rounded p-1.5 text-muted-foreground hover:bg-muted"
              onClick={() => requestToggle(null)}
              aria-label="收起面板"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Routes>
              {SHELL_ROUTES.map(route => (
                <Route key={route.id} path={route.path} element={ROUTE_ELEMENTS[route.id]} />
              ))}
            </Routes>
          </div>
        </div>
      )}
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-l border-border bg-muted/40 py-2">
        {ITEMS.map(item => {
          const Icon = item.icon
          const isActive = rail.panelOpen && rail.routeId === item.id
          return (
            <button
              type="button"
              key={item.id}
              title={item.label}
              onClick={() => {
                if (item.external) {
                  void window.ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, GITHUB_URL)
                  return
                }
                requestToggle(item.id)
              }}
              className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
            </button>
          )
        })}
      </div>
    </>
  )
}
