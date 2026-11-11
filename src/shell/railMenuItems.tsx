// 顶栏悬浮菜单项（壳 v3 · Wave 3 · 计划 §5.3）
//
// 为什么单独成文件：56px 图标条删除后，功能入口改由顶栏「展开 Live Mod」按钮开出的
// 悬浮列表承担。清单与图标映射**不得从 ShellRail.tsx 导出**（TC-E1/TC-E2 边界：
// chrome 保持最小树，只多一个 invoke；rail 仍是完整业务树唯一宿主）。
import {
  Gift,
  HelpCircle,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Settings,
  Tv,
} from 'lucide-react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { SHELL_RAIL_ROUTES, type ShellRouteId } from 'shared/shellRoutes'

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

export interface RailMenuItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** 外链项：点击直接开浏览器，不走面板 */
  external?: boolean
}

/** 菜单清单：右栏路由 + 帮助外链（共 7 项，单列列表） */
export const RAIL_MENU_ITEMS: readonly RailMenuItem[] = [
  ...SHELL_RAIL_ROUTES.map(route => ({
    id: route.id,
    label: route.label,
    icon: ROUTE_ICONS[route.id],
  })),
  { id: 'help', label: '帮助', icon: HelpCircle, external: true },
]

/**
 * 顶栏悬浮菜单（单列：图标 + 名称，D3 决策）。
 *
 * 动效：与面板同档（180ms / 标准曲线），从右上滑入；
 * reduced-motion 下由全局 CSS 降为瞬时且延迟 0（§13-3）。
 */
export function RailMenuList({ activeRouteId }: { activeRouteId?: string | null }) {
  return (
    // 只呈现功能卡本身：不再有外层卡片边框/底色/标题栏（菜单宿主只负责定位与进出场）。
    <ul
      data-testid="rail-menu"
      data-state="open"
      className="flex max-h-[288px] w-full flex-col gap-1 overflow-y-auto"
    >
      {RAIL_MENU_ITEMS.map(item => {
        const Icon = item.icon
        const isActive = activeRouteId === item.id
        return (
          <li key={item.id}>
            <button
              type="button"
              data-testid={`rail-menu-item-${item.id}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => {
                if (item.external) {
                  void window.ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, GITHUB_URL)
                  return
                }
                void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railMenuSelect, item.id)
              }}
              className={`flex w-full items-center gap-2.5 rounded-card border-hairline border-border bg-card px-3 py-2 text-left text-[13px] shadow-elevation-1 transition-colors hover:bg-muted ${
                isActive ? 'border-primary text-primary' : 'text-foreground'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
