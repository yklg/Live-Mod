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
const readIfExists = (rel: string) => {
  try {
    return read(rel)
  } catch {
    return null
  }
}

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

  it('每个路由都有唯一 panelTitle，且 live/settings 与图标条 label 区分', () => {
    const titles = SHELL_ROUTES.map(r => r.panelTitle)
    expect(titles.every(Boolean)).toBe(true)
    expect(new Set(titles).size).toBe(titles.length)
    expect(SHELL_ROUTES.find(r => r.id === 'live')?.panelTitle).toBe('直播控制台')
    expect(SHELL_ROUTES.find(r => r.id === 'live')?.label).toBe('中控台')
    expect(SHELL_ROUTES.find(r => r.id === 'settings')?.panelTitle).toBe('应用设置')
    expect(SHELL_ROUTES.find(r => r.id === 'settings')?.label).toBe('账号/设置')
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

  it('消费方不再手写 AI 路由（经典 router 已移除）', () => {
    const rail = read('../src/shell/ShellRail.tsx')
    expect(rail).toContain('SHELL_RAIL_ROUTES')
    expect(rail).toContain('SHELL_ROUTES')
    expect(rail).not.toContain('/ai-chat')
    expect(readIfExists('../src/router/index.tsx')).toBeNull()
  })
})
