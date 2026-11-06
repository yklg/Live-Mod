import { describe, expect, it, vi } from 'vitest'
import { teardownSession } from '#/driver/types'

// ===== 测试基础设施 =====
// teardownSession 生命周期守卫（C1）与所有权约束（评审 P1-1）单元契约测试。
// 守护不变量：
//   I1 按 kind 分派，browser.close 恰好一次（幂等防重入）
//   I2 任何 kind 都不得触碰非本 session 的 Page/Context（所有权守卫）
//   I3 attached 绝不主动 close 自己的 Page（断连语义，关页面=杀壳）
// 注：attached 下 browser.close() 仅断 CDP 不杀宿主属 Playwright 内部语义，
//     由 E2E（TC-E1）真实验证；本文件锁定其可观测调用形态。

function makePage(url: string) {
  return { url: () => url, close: vi.fn(async () => {}) }
}

function makeSession(
  kind: 'launched' | 'attached',
  ownUrl = 'https://fxg.jinritemai.com/a',
  otherUrls: string[] = [],
) {
  const own = makePage(ownUrl)
  const others = otherUrls.map(makePage)
  const browser = { close: vi.fn(async () => {}) }
  const context = {
    pages: vi.fn(() => [own, ...others]),
    close: vi.fn(async () => {}),
  }
  return {
    session: { kind, browser, context, page: own } as never,
    own,
    others,
    browser,
    context,
  }
}

describe('teardownSession 生命周期守卫（TC-U1 ~ TC-U3）', () => {
  it('TC-U1 [attached] 仅断连：browser.close 恰好一次，不 close 自身 Page/Context', async () => {
    const { session, own, context, browser } = makeSession('attached')
    await teardownSession(session)
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(own.close).not.toHaveBeenCalled()
    expect(context.close).not.toHaveBeenCalled()
  })

  it('TC-U1b [幂等] 重复 teardown 不二次 close（防重入）', async () => {
    const { session, browser } = makeSession('attached')
    await teardownSession(session)
    await teardownSession(session)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('TC-U2 [launched 回归基线] 调用形态与 attached 同形（结束进程语义由 Playwright 内部保证，行为不随重构改变）', async () => {
    const { session, own, browser } = makeSession('launched')
    await teardownSession(session)
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(own.close).not.toHaveBeenCalled()
  })

  it('TC-U3 [所有权守卫] 多会话共存时，teardown 只触碰本 session target', async () => {
    const { session, others } = makeSession('attached', 'https://a.example/own', [
      'https://b.example/other1',
      'https://c.example/other2',
    ])
    await teardownSession(session)
    for (const other of others) {
      expect(other.close).not.toHaveBeenCalled()
    }
  })

  it('TC-U3b [所有权守卫] 不得以遍历 context.pages 方式批量关闭', async () => {
    const { session, context } = makeSession('attached', 'https://a/own', ['https://b/other'])
    await teardownSession(session)
    // 允许实现读取 pages()（如状态检查），但其他 page 未被 close 已由 TC-U3 断言；
    // 此处锁定更强的实现纪律：不通过 context.close 连坐
    expect(context.close).not.toHaveBeenCalled()
  })
})
