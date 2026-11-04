import type { LucideIcon } from 'lucide-react'
import { AppWindow, Bot, Gift, MessageSquare, MonitorPlay, Reply, Settings } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { autoReplyPlatforms } from '@/abilities'
import { useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { version as APP_VERSION } from '../../../package.json'
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarShell,
} from '../ui/sidebar'
import { AccountSwitcher } from './AccountSwitcher'
import { ThemeToggle } from './ThemeToggle'

interface SidebarNavItem {
  id: string
  name: string
  icon: LucideIcon
  isRunning?: boolean
  platform?: LiveControlPlatform[]
}

function NavItem({ item, active }: { item: SidebarNavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.name}>
        <NavLink to={item.id}>
          <Icon className="h-4.5 w-4.5 shrink-0" />
          <span>{item.name}</span>
          {item.isRunning && (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              运行中
            </span>
          )}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export default function Sidebar() {
  const isAutoMessageRunning = useCurrentAutoMessage(context => context.isRunning)
  const isAutoPopupRunning = useCurrentAutoPopUp(context => context.isRunning)
  const { isRunning: isAutoReplyRunning } = useAutoReply()
  const platform = useCurrentLiveControl(context => context.platform)
  const { pathname } = useLocation()

  const isActive = (id: string) => (id === '/' ? pathname === '/' : pathname.startsWith(id))

  const navGroups: { label: string; items: SidebarNavItem[] }[] = [
    {
      label: '直播',
      items: [
        { id: '/', name: '打开中控台', icon: MonitorPlay },
        {
          id: '/auto-message',
          name: '自动发言',
          icon: MessageSquare,
          isRunning: isAutoMessageRunning,
        },
        { id: '/auto-popup', name: '自动弹窗', icon: AppWindow, isRunning: isAutoPopupRunning },
        {
          id: '/auto-reply',
          name: '自动回复',
          icon: Reply,
          isRunning: isAutoReplyRunning,
          platform: autoReplyPlatforms,
        },
        {
          id: '/red-packet',
          name: '一键发红包',
          icon: Gift,
          platform: ['douyin', 'buyin'],
        },
      ],
    },
    { label: '智能', items: [{ id: '/ai-chat', name: 'AI 助手', icon: Bot }] },
    { label: '系统', items: [{ id: '/settings', name: '应用设置', icon: Settings }] },
  ]

  const groups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.platform || item.platform.includes(platform)),
    }))
    .filter(group => group.items.length > 0)

  return (
    <SidebarShell collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <img
            src="/favicon.png"
            alt="直播助手"
            className="h-8 w-8 shrink-0 rounded-lg bg-background/60 p-0.5"
          />
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">直播助手</span>
            <span className="truncate text-xs text-muted-foreground">v{APP_VERSION}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map(group => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(item => (
                  <NavItem key={item.id} item={item} active={isActive(item.id)} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <AccountSwitcher />
        <ThemeToggle />
      </SidebarFooter>
    </SidebarShell>
  )
}
