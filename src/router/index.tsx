import type { ReactNode } from 'react'
import { createHashRouter } from 'react-router'
import { SHELL_ROUTES, type ShellRouteId } from 'shared/shellRoutes'
import AutoMessage from '@/pages/AutoMessage'
import AutoPopUp from '@/pages/AutoPopUp'
import AutoReply from '@/pages/AutoReply'
import AutoReplySettings from '@/pages/AutoReply/AutoReplySettings'
import LiveControl from '@/pages/LiveControl'
import LiveInteraction from '@/pages/LiveInteraction'
import RedPacket from '@/pages/RedPacket'
import Settings from '@/pages/SettingsPage'
import App from '../App'

const ROUTE_ELEMENTS: Record<ShellRouteId, ReactNode> = {
  live: <LiveControl />,
  popup: <AutoPopUp />,
  message: <AutoMessage />,
  reply: <AutoReply />,
  'reply-settings': <AutoReplySettings />,
  interaction: <LiveInteraction />,
  settings: <Settings />,
  'red-packet': <RedPacket />,
}

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: SHELL_ROUTES.map(route => ({
      path: route.path,
      element: ROUTE_ELEMENTS[route.id],
    })),
  },
])
