import { describe, expect, it, vi } from 'vitest'
import { locateByNonce } from '#/driver/pageFactory'

// ===== nonce 寻址契约（评审 P0-2：与 PoC 实证对齐；禁止裸 URL/partition 匹配）=====
// 守护不变量：
//   I6 只按完整 nonce 匹配，绝不部分匹配/裸 URL 匹配
//   I7 超时归约 F1（拒绝），且触发 disposeWindow（无窗口泄漏）
//   I8 并发寻址互不串号（所有权前置）

const fakePage = (url: string) => ({ url: () => url })
const fakeBrowser = (urls: string[]) => ({
  contexts: () => [{ pages: () => urls.map(fakePage) }],
})

function makeArgs(nonce: string, urls: string[], timeoutMs = 15000) {
  return {
    browser: fakeBrowser(urls) as never,
    nonce,
    timeoutMs,
    disposeWindow: vi.fn(async () => {}),
    // 注入时钟：轮询回调驱动，不用真定时器
    poll: { intervalMs: 100, setTimeout: (fn: () => void) => fn() },
  }
}

describe('locateByNonce（TC-U9 ~ TC-U10）', () => {
  it('TC-U9 [命中] 返回 nonce 对应的 Page', async () => {
    const a = makeArgs('lm-nonce-a1-uuid1', ['about:blank#lm-nonce-a1-uuid1', 'https://other'])
    const page = await locateByNonce(a)
    expect(page.url()).toBe('about:blank#lm-nonce-a1-uuid1')
    expect(a.disposeWindow).not.toHaveBeenCalled()
  })

  it('TC-U9b [超时 → F1] 拒绝并 disposeWindow（窗口不泄漏）', async () => {
    const a = makeArgs('lm-nonce-a1-gone', ['https://elsewhere'])
    await expect(locateByNonce(a)).rejects.toMatchObject({ code: 'nonce-timeout' })
    expect(a.disposeWindow).toHaveBeenCalledTimes(1)
  })

  it('TC-U10 [并发隔离] 同 accountId 不同 uuid 各自命中自己', async () => {
    const urls = ['about:blank#lm-nonce-a1-u1', 'about:blank#lm-nonce-a1-u2']
    const p1 = await locateByNonce(makeArgs('lm-nonce-a1-u1', urls))
    const p2 = await locateByNonce(makeArgs('lm-nonce-a1-u2', urls))
    expect(p1.url()).not.toBe(p2.url())
  })

  it('TC-U10b [禁部分匹配] 前缀相同的他人 nonce 不得误命中', async () => {
    const a = makeArgs('lm-nonce-a1-u2', ['about:blank#lm-nonce-a1-u22'])
    await expect(locateByNonce(a)).rejects.toMatchObject({ code: 'nonce-timeout' })
  })
})
