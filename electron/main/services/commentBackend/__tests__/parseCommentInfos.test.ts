import { describe, expect, it } from 'vitest'
import { createCommentDeduper, parseCommentInfos } from '#/services/commentBackend/parseCommentInfos'

// B2 评论后端解析契约（阶段 1）
const body = (infos: unknown) => JSON.stringify({ st: 0, code: 0, data: { comment_infos: infos } })

describe('parseCommentInfos（TC-CB1~CB5）', () => {
  it('TC-CB1 正常解析：id/昵称/内容/时间（秒→毫秒）', () => {
    const list = parseCommentInfos(
      body([{ comment_id: 'c1', nick_name: 'A', content: ' 你好 ', create_time: 100 }]),
      999,
    )
    expect(list).toEqual([{ id: 'c1', nickName: 'A', content: '你好', at: 100_000, raw: expect.any(Object) }])
  })

  it('TC-CB2 空响应体/空列表/非 JSON → []（不抛错）', () => {
    expect(parseCommentInfos('')).toEqual([])
    expect(parseCommentInfos(body([]))).toEqual([])
    expect(parseCommentInfos('not-json')).toEqual([])
    expect(parseCommentInfos(JSON.stringify({ data: {} }))).toEqual([])
  })

  it('TC-CB3 畸形字段容错：缺内容跳过、缺 id 用序号、非法 create_time 用 now', () => {
    const list = parseCommentInfos(
      body([
        { content: '   ' },
        { nick_name: 'B', content: 'ok' },
        { comment_id: 42, content: 'num', create_time: 0 },
      ]),
      1234,
    )
    expect(list.map(c => c.id)).toEqual(['idx-1', '42'])
    expect(list.every(c => c.at === 1234)).toBe(true)
  })

  it('TC-CB4 去重器：同 id 只出一次，超出容量淘汰最旧', () => {
    const d = createCommentDeduper(2)
    const mk = (id: string) => ({ id, nickName: '', content: 'x', at: 1 })
    expect(d.take([mk('a'), mk('b')])).toHaveLength(2)
    expect(d.take([mk('a'), mk('b'), mk('c')])).toEqual([mk('c')])
    expect(d.take([mk('a')])).toEqual([mk('a')])
  })

  it('TC-CB5 同一批只回调新增部分（轮询重复场景）', () => {
    const d = createCommentDeduper(100)
    const list = parseCommentInfos(body([{ comment_id: 'x', content: 'hi' }]))
    expect(d.take(list)).toHaveLength(1)
    expect(d.take(list)).toHaveLength(0)
  })
})
