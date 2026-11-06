// nonce 寻址器（browser-shell-formalization-plan v3 · Phase 0，A1：纯寻址，不 import Electron UI API）
// 契约（pageFactory.test.ts TC-U9~U10b 固化）：
// - 只按 `#${nonce}` 完整后缀精确匹配，禁止部分匹配/裸 URL/partition 匹配（P0-2，对齐 PoC 实证）
// - 超时归约 F1：disposeWindow（窗口不泄漏）+ 抛 { code:'nonce-timeout' }
import type { Page } from 'playwright'

export interface LocateArgs {
  browser: { contexts: () => { pages: () => Page[] }[] }
  nonce: string
  timeoutMs?: number
  disposeWindow: () => Promise<void>
  poll?: { intervalMs: number; setTimeout: (fn: () => void) => unknown }
}

export class NonceTimeoutError extends Error {
  readonly code = 'nonce-timeout'
  constructor(nonce: string) {
    super(`nonce 寻址超时: ${nonce}`)
    this.name = 'NonceTimeoutError'
  }
}

export async function locateByNonce(args: LocateArgs): Promise<Page> {
  const { browser, nonce, disposeWindow } = args
  const timeoutMs = args.timeoutMs ?? 15000
  const poll = args.poll ?? { intervalMs: 200, setTimeout: (fn: () => void) => setTimeout(fn, 200) }
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / poll.intervalMs))
  const suffix = `#${nonce}`

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().endsWith(suffix)) return page
      }
    }
    await new Promise<void>(resolve => poll.setTimeout(() => resolve()))
  }

  await disposeWindow()
  throw new NonceTimeoutError(nonce)
}
