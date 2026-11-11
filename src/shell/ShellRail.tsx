// 右栏功能面板（壳 v3 · Wave 2：56px 图标条已删除，rail 视图自此只承载面板）
// 图标映射（Live Mod 功能映射，对标光圈七项右栏）：
//   中控台→LiveControl 连接页 / 自动弹窗 / 自动发言 / 自动回复 / AI 助手 / 设置 / 帮助(外链)
// 开合态（A2）：初始由视口宽度推导（railView bounds 即真源镜像），此后完全跟随 shell:rail:state 推送；
// 本组件不持有开合状态——点击/ESC/× 一律发 railToggle 请求给主进程。
//
// 壳 v3 · Wave 2 变更（计划 §4.2 / §13）：
// - 删除 56px 图标条（D4）：右栏不再有图标列，功能入口改由顶栏悬浮菜单承担（Wave 3）。
// - 面板改为「**保留节点 + data-state**」（§13-6 离场载体）：关闭时先播离场动画再卸载，
//   否则条件渲染会直接卸载节点，离场动画永远没有播放机会。

import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import type { ShellRailState } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { SHELL_ROUTES, type ShellRouteId } from 'shared/shellRoutes'
import { Toaster } from '@/components/ui/toaster'
import { UpdateDialog } from '@/components/update/UpdateDialog'
import { useGlobalIpcListener } from '@/hooks/useGlobalIpcListener'
import AutoMessage from '@/pages/AutoMessage'
import AutoPopUp from '@/pages/AutoPopUp'
import AutoReply from '@/pages/AutoReply'
import AutoReplySettings from '@/pages/AutoReply/AutoReplySettings'
import LiveControl from '@/pages/LiveControl'
import LiveInteraction from '@/pages/LiveInteraction'
import RedPacket from '@/pages/RedPacket'
import SettingsPage from '@/pages/SettingsPage'
import { RailMenuList } from './railMenuItems'

/** 动效时长：与设计令牌 --motion-base 一致（180ms） */
const MOTION_BASE_MS = 180

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

/**
 * 面板标题/路径查找表（壳 v3 · Wave 3）。
 *
 * 图标映射随 56px 图标条一起删除：功能入口改由顶栏悬浮菜单承担，
 * 图标归 `railMenuItems.tsx`（清单唯一真源，且**不得**从本文件导出）。
 */
const PANEL_META: Record<string, { label: string; panelTitle?: string; path?: string }> =
  Object.fromEntries(
    SHELL_ROUTES.map(route => [
      route.id,
      { label: route.label, panelTitle: route.panelTitle, path: route.path },
    ]),
  )

function requestToggle(routeId?: string | null) {
  void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railToggle, routeId ?? null)
}

/** 用户是否要求减少动效（§13-3：reduced-motion 下延迟严格为 0） */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

/**
 * 节点的挂载态（离场载体，§13-6）。
 *
 * 关闭时**不立即卸载**：先让节点以 data-state="closed" 播离场动画，
 * 动画结束后再卸载。这样不会出现「节点已卸载但动画仍在」，也不会出现
 * 「动画未完成就重建」。reduced-motion 下延迟为 0（动画本身被 CSS 关掉）。
 */
function useMountedWhile(open: boolean): boolean {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(
      () => setMounted(false),
      prefersReducedMotion() ? 0 : MOTION_BASE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [open])
  return mounted
}

export function ShellRailRoot() {
  // 完整业务树唯一宿主（TC-E2 反向断言目标）：全局事件监听恰好注册一次
  useGlobalIpcListener()
  // 初始态由视口宽度推导（bounds 镜像）：rail 视图宽度 > 0 ⟺ 面板打开
  // （壳 v3 · Wave 2：图标条删除后 rail 视图就是面板本身，收起时宽度为 0）
  const [rail, setRail] = useState<ShellRailState>({
    panelOpen: window.innerWidth > 0,
    routeId: null,
    menuOpen: false,
  })

  useEffect(() => {
    return window.ipcRenderer.on(IPC_CHANNELS.shell.railState, s => setRail(s))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // ESC 关菜单优先（菜单开着时面板已让位）（壳 v3 · Wave 3）
      if (rail.menuOpen) {
        void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railMenuToggle)
        return
      }
      if (rail.panelOpen) requestToggle(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rail.panelOpen, rail.menuOpen])

  const panelMounted = useMountedWhile(rail.panelOpen)
  const menuMounted = useMountedWhile(rail.menuOpen)

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
              // 壳 v3 · Wave 2：图标条已删，rail 视图宽就是面板宽（导体只接受 dock 宽）。
              Math.max(0, window.innerWidth),
              e.screenX,
            )
          }}
        />
      )}
      <MemoryRouter initialEntries={[PANEL_META[rail.routeId ?? '']?.path ?? '/']}>
        <ShellRailLayout rail={rail} panelMounted={panelMounted} menuMounted={menuMounted} />
      </MemoryRouter>
      <Toaster />
      <UpdateDialog panelOpen={rail.panelOpen} />
    </div>
  )
}

function ShellRailLayout({
  rail,
  panelMounted,
  menuMounted,
}: {
  rail: ShellRailState
  panelMounted: boolean
  menuMounted: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [lastRoute, setLastRoute] = useState<string | null>(null)

  // 跟随推送换页：routeId 变化才 navigate（面板内容由路由决定，开合由主进程决定）
  useEffect(() => {
    if (rail.panelOpen && rail.routeId && rail.routeId !== lastRoute) {
      const item = PANEL_META[rail.routeId]
      if (item?.path) navigate(item.path)
      setLastRoute(rail.routeId)
    }
  }, [rail, lastRoute, navigate])

  const activeItem = PANEL_META[rail.routeId ?? '']
  const activeRoute =
    SHELL_ROUTES.find(r => r.path === location.pathname) ??
    SHELL_ROUTES.find(r => r.id === rail.routeId)
  const panelTitle =
    activeRoute?.panelTitle ?? activeItem?.panelTitle ?? activeItem?.label ?? '功能面板'

  return (
    <>
      {/* 顶栏悬浮菜单（壳 v3 · Wave 3）：与面板互斥，切换时两段动画重叠播放 */}
      {menuMounted && (
        <div
          data-testid="shell-menu-host"
          data-state={rail.menuOpen ? 'open' : 'closed'}
          className="flex w-full flex-col p-1 motion-base data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2"
        >
          <RailMenuList activeRouteId={rail.routeId} />
        </div>
      )}
      {panelMounted && (
        <div
          data-testid="shell-panel"
          data-state={rail.panelOpen ? 'open' : 'closed'}
          className="flex min-w-0 flex-1 flex-col border-l border-border motion-base data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-2"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <h1 data-testid="panel-title" className="flex-1 truncate text-[13px] font-semibold">
              {panelTitle}
            </h1>
            {/* 面板是 overlay，会盖住官方页面右侧（抖店中控台的评论区/观众列表就在那里）。
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
              className="rounded-control p-1.5 text-muted-foreground hover:bg-muted"
              onClick={() => requestToggle(null)}
              aria-label="收起面板"
            >
              <X className="size-3.5" />
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
    </>
  )
}
