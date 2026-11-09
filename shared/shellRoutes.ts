// 壳路由单一源（shell-ui v4）：ShellRail、经典 router、LayoutStore 都从这里取。
// 约束：AI 路由已退场（AI 只以全局浮窗存在）；red-packet / auto-reply-settings 是可达路由但不是右栏图标。
// 本文件不 import React / Electron，确保可被主进程与渲染层共用、可在 vitest 直接测试。

export type ShellRouteId =
  | 'live'
  | 'popup'
  | 'message'
  | 'reply'
  | 'reply-settings'
  | 'interaction'
  | 'settings'
  | 'red-packet'

export interface ShellRouteDefinition {
  /** 稳定 id；LayoutStore 持久化 routeId 用这个，不用 path。 */
  id: ShellRouteId
  path: string
  label: string
  /** 是否出现在右栏图标条。 */
  rail: boolean
}

export const SHELL_ROUTES: readonly ShellRouteDefinition[] = [
  { id: 'live', path: '/', label: '中控台', rail: true },
  { id: 'popup', path: '/auto-popup', label: '自动弹窗', rail: true },
  { id: 'message', path: '/auto-message', label: '自动发言', rail: true },
  { id: 'reply', path: '/auto-reply', label: '自动回复', rail: true },
  { id: 'reply-settings', path: '/auto-reply/settings', label: '自动回复设置', rail: false },
  { id: 'interaction', path: '/live-interaction', label: '直播互动', rail: true },
  { id: 'settings', path: '/settings', label: '账号/设置', rail: true },
  { id: 'red-packet', path: '/red-packet', label: '一键发红包', rail: false },
]

export const SHELL_RAIL_ROUTES: readonly ShellRouteDefinition[] = SHELL_ROUTES.filter(
  route => route.rail,
)

const BY_ID = new Map<string, ShellRouteDefinition>(SHELL_ROUTES.map(route => [route.id, route]))
const BY_PATH = new Map<string, ShellRouteDefinition>(
  SHELL_ROUTES.map(route => [route.path, route]),
)

export function isKnownShellRouteId(value: unknown): value is ShellRouteId {
  return typeof value === 'string' && BY_ID.has(value)
}

export function shellRouteById(id: string | null | undefined): ShellRouteDefinition | null {
  return id ? (BY_ID.get(id) ?? null) : null
}

export function shellRouteByPath(path: string | null | undefined): ShellRouteDefinition | null {
  if (!path) return null
  const normalized = normalizeShellPath(path)
  return BY_PATH.get(normalized) ?? null
}

/** 去掉 query/hash 与尾斜杠（根路径保留 `/`），用于路由 id 反查。 */
export function normalizeShellPath(path: string): string {
  const withoutSuffix = path.split(/[?#]/, 1)[0] || '/'
  if (withoutSuffix === '/') return '/'
  return withoutSuffix.replace(/\/+$/, '') || '/'
}

export function shellRouteIdForPath(path: string | null | undefined): ShellRouteId | null {
  return shellRouteByPath(path)?.id ?? null
}

export function pathForShellRouteId(id: string | null | undefined): string | null {
  return shellRouteById(id)?.path ?? null
}
