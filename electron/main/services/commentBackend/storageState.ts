// B2 登录态快照 → Playwright storageState（纯函数，可单测）
import type { CommentStateSnapshot } from './contracts'

interface ElectronCookieLike {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  expirationDate?: number
  sameSite?: string
}

const SAME_SITE: Record<string, 'Strict' | 'Lax' | 'None'> = {
  strict: 'Strict',
  lax: 'Lax',
  none: 'None',
}

export function toPlaywrightCookies(cookies: unknown[]): Array<Record<string, unknown>> {
  return (cookies as ElectronCookieLike[])
    .filter(c => c && typeof c.name === 'string' && typeof c.value === 'string')
    .map(c => {
      const sameSite = c.sameSite ? SAME_SITE[String(c.sameSite).toLowerCase()] : undefined
      return {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
        secure: c.secure ?? false,
        httpOnly: c.httpOnly ?? false,
        ...(sameSite ? { sameSite } : {}),
        ...(c.expirationDate && !c.session ? { expires: c.expirationDate } : { expires: -1 }),
      }
    })
}

/** 生成 Playwright storageState JSON（origin 取 consoleUrl 的源） */
export function buildStorageState(snapshot: CommentStateSnapshot, consoleUrl: string): string {
  const origin = new URL(consoleUrl).origin
  return JSON.stringify({
    cookies: toPlaywrightCookies(snapshot.cookies),
    origins: [
      {
        origin,
        localStorage: Object.entries(snapshot.localStorage).map(([name, value]) => ({
          name,
          value,
        })),
      },
    ],
  })
}

/** 登录页判定（后端启动后 URL 落到登录/SSO → 视为登录态失效） */
export function isLoginUrl(url: string): boolean {
  return /\/login|\/passport|sso\./i.test(url)
}
