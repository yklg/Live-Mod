// 右栏图标条 + 800px 功能面板（guangquan-shell-ui-parity v3 · P2 RailPanel）
// 图标映射（Live Mod 功能映射，对标光圈七项右栏）：
//   中控台→LiveControl 连接页 / 自动弹窗 / 自动发言 / 自动回复 / AI 助手 / 设置 / 帮助(外链)
// 开合态（A2）：初始由视口宽度推导（railView bounds 即真源镜像），此后完全跟随 shell:rail:state 推送；
// 本组件不持有开合状态——图标点击/ESC/× 一律发 railToggle 请求给主进程。

import {
  Gift,
  HelpCircle,
  Megaphone,
  MessagesSquare,
  Settings,
  Sparkles,
  Tv,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import type { ShellRailState } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useGlobalIpcListener } from '@/App'
import { Toaster } from '@/components/ui/toaster'
import { UpdateDialog } from '@/components/update/UpdateDialog'
import { useToast } from '@/hooks/useToast'
import AIChat from '@/pages/AIChat'
import AutoMessage from '@/pages/AutoMessage'
import AutoPopUp from '@/pages/AutoPopUp'
import AutoReply from '@/pages/AutoReply'
import AutoReplySettings from '@/pages/AutoReply/AutoReplySettings'
import LiveControl from '@/pages/LiveControl'
import RedPacket from '@/pages/RedPacket'
import SettingsPage from '@/pages/SettingsPage'

const GITHUB_URL = 'https://github.com/yklg/Live-Mod'

interface RailItem {
  id: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  path?: string
  external?: boolean
}

const ITEMS: RailItem[] = [
  { id: 'live', icon: Tv, label: '中控台', path: '/' },
  { id: 'popup', icon: Gift, label: '自动弹窗', path: '/auto-popup' },
  { id: 'msg', icon: Megaphone, label: '自动发言', path: '/auto-message' },
  { id: 'reply', icon: MessagesSquare, label: '自动回复', path: '/auto-reply' },
  { id: 'ai', icon: Sparkles, label: 'AI 助手', path: '/ai-chat' },
  { id: 'set', icon: Settings, label: '账号/设置', path: '/settings' },
  { id: 'help', icon: HelpCircle, label: '帮助', external: true },
]

const RAIL_W = 56

function requestToggle(routeId?: string | null) {
  void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railToggle, routeId ?? null)
}

export function ShellRailRoot() {
  // 完整业务树唯一宿主（TC-E2 反向断言目标）：全局事件监听恰好注册一次
  useGlobalIpcListener()
  const { toast } = useToast()
  // 初始态由视口宽度推导（bounds 镜像），此后只信主进程推送（A2 单源）
  const [rail, setRail] = useState<ShellRailState>({
    panelOpen: window.innerWidth > RAIL_W,
    routeId: null,
  })

  useEffect(() => {
    return window.ipcRenderer.on(IPC_CHANNELS.shell.railState, s => setRail(s))
  }, [])

  useEffect(
    () =>
      window.ipcRenderer.on(IPC_CHANNELS.shell.warnToast, message => {
        toast.error(message)
      }),
    [toast],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rail.panelOpen) requestToggle(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rail.panelOpen])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
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
              <Route path="/" element={<LiveControl />} />
              <Route path="/auto-popup" element={<AutoPopUp />} />
              <Route path="/auto-message" element={<AutoMessage />} />
              <Route path="/auto-reply" element={<AutoReply />} />
              <Route path="/auto-reply/settings" element={<AutoReplySettings />} />
              <Route path="/ai-chat" element={<AIChat />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/red-packet" element={<RedPacket />} />
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
