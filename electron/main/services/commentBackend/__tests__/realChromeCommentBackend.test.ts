import { describe, expect, it, vi } from 'vitest'

// 单测环境无 Electron app：logger 依赖 electron（app.getAppPath）→ 以纯桩替换，聚焦后端契约
vi.mock('#/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    scope: () => ({ info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() }),
  }),
}))

import { RealChromeCommentBackend } from '#/services/commentBackend/RealChromeCommentBackend'

// 批 A：后端单轮响应处理契约（handleBody，不依赖 Electron/Playwright）
// fixture 为按真实 comment/info 响应结构脱敏合成的样本（非抓包原文）
const body = (infos: unknown[]) =>
  JSON.stringify({ st: 0, code: 0, data: { comment_infos: infos } })
const fixture1 = body([
  { comment_id: '77053', nick_name: '用户A', content: '多大的好吃？', create_time: 1794050000 },
  { comment_id: '77054', nick_name: '用户B', content: '甜不甜', create_time: 1794050001 },
])
const fixture1Again = body([
  { comment_id: '77053', nick_name: '用户A', content: '多大的好吃？', create_time: 1794050000 },
  { comment_id: '77055', nick_name: '用户C', content: '拍了特大果', create_time: 1794050002 },
])

function makeBackend() {
  const onComment = vi.fn()
  const onStatus = vi.fn()
  const backend = new RealChromeCommentBackend({
    createSession: async () => {
      throw new Error('not used in handleBody tests')
    },
    getState: async () => ({ cookies: [], localStorage: {} }),
    consoleUrl: 'about:blank',
    onComment,
    onStatus,
    now: () => 1_000,
  })
  return { backend, onComment, onStatus }
}

describe('RealChromeCommentBackend.handleBody（TC-CB6~CB9）', () => {
  it('TC-CB6 首轮去重后逐条回调，状态置 live 并累计计数', () => {
    const { backend, onComment, onStatus } = makeBackend()
    backend.handleBody(fixture1)
    expect(onComment).toHaveBeenCalledTimes(2)
    expect(backend.getStatus()).toMatchObject({ state: 'live', comments: 2, lastCommentAt: 1_000 })
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'live' }))
  })

  it('TC-CB7 轮询重复批次只回调新增评论（按 comment_id 去重）', () => {
    const { backend, onComment } = makeBackend()
    backend.handleBody(fixture1)
    onComment.mockClear()
    backend.handleBody(fixture1Again)
    expect(onComment).toHaveBeenCalledTimes(1)
    expect(onComment.mock.calls[0][0].id).toBe('77055')
    expect(backend.getStatus().comments).toBe(3)
  })

  it('TC-CB8 空体/畸形响应不改变状态与计数', () => {
    const { backend, onComment } = makeBackend()
    backend.handleBody('')
    backend.handleBody('not-json')
    backend.handleBody(JSON.stringify({ data: {} }))
    expect(onComment).not.toHaveBeenCalled()
    expect(backend.getStatus()).toMatchObject({ state: 'idle', comments: 0 })
  })

  it('TC-CB9 stop 后不再回调（生命周期边界）', async () => {
    const { backend, onComment } = makeBackend()
    await backend.stop()
    backend.handleBody(fixture1)
    expect(onComment).not.toHaveBeenCalled()
    expect(backend.getStatus().state).toBe('stopped')
  })
})
