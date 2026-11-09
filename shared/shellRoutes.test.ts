import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isKnownShellRouteId,
  normalizeShellPath,
  pathForShellRouteId,
  SHELL_RAIL_ROUTES,
  SHELL_ROUTES,
  shellRouteIdForPath,
} from './shellRoutes'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('shellRoutes 单一源', () => {
  it('id/path 唯一，且 AI 路由已退场', () => {
    const ids = SHELL_ROUTES.map(r => r.id)
    const paths = SHELL_ROUTES.map(r => r.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
    expect(ids).not.toContain('ai')
    expect(paths).not.toContain('/ai-chat')
  })

  it('右栏 6 条路由（help 由 ShellRail 单独外链）', () => {
    expect(SHELL_RAIL_ROUTES.map(r => r.id)).toEqual([
      'live',
      'popup',
      'message',
      'reply',
      'interaction',
      'settings',
    ])
    expect(SHELL_RAIL_ROUTES.every(r => r.rail)).toBe(true)
  })

  it('path/id 互查与未知值回退', () => {
    expect(pathForShellRouteId('reply-settings')).toBe('/auto-reply/settings')
    expect(shellRouteIdForPath('/auto-reply/settings?from=panel#top')).toBe('reply-settings')
    expect(shellRouteIdForPath('/red-packet')).toBe('red-packet')
    expect(shellRouteIdForPath('/ai-chat')).toBeNull()
    expect(isKnownShellRouteId('ai')).toBe(false)
    expect(isKnownShellRouteId('settings')).toBe(true)
    expect(pathForShellRouteId('nope')).toBeNull()
  })

  it('路径归一化：query/hash/尾斜杠', () => {
    expect(normalizeShellPath('/')).toBe('/')
    expect(normalizeShellPath('/auto-reply/')).toBe('/auto-reply')
    expect(normalizeShellPath('/auto-reply?x=1#y')).toBe('/auto-reply')
  })

  it('消费方不再手写 AI 路由', () => {
    const rail = read('../src/shell/ShellRail.tsx')
    const router = read('../src/router/index.tsx')
    expect(rail).toContain('SHELL_RAIL_ROUTES')
    expect(rail).toContain('SHELL_ROUTES')
    expect(rail).not.toContain('/ai-chat')
    expect(router).toContain('SHELL_ROUTES')
    expect(router).not.toContain('AIChat')
    expect(router).not.toContain('/ai-chat')
  })
})
