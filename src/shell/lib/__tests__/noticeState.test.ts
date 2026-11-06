import { describe, expect, it } from 'vitest'
import { NOTICE } from '@/constants'
import { initialNoticeState, noticeReducer, type NoticeState } from '@/shell/lib/noticeState'

// ===== 通知展示态 reducer（shell-ui-polish v3 · TC-NS-01~04）=====
// 契约：去重窗口 800ms（同 variant+description）；上限 3（超出淘汰最旧并累计 dropped）；超时移除；clear 复位。
const push = (state: NoticeState, description: string, now: number, variant: NoticeVariant = 'info') =>
  noticeReducer(state, { type: 'push', payload: { variant, description }, now })

describe('noticeState reducer（TC-NS-01~04）', () => {
  it('TC-NS-01 上限 3：第 4 条淘汰最旧并累计 dropped', () => {
    let s = initialNoticeState
    s = push(s, 'a', 1000)
    s = push(s, 'b', 1100)
    s = push(s, 'c', 1200)
    s = push(s, 'd', 1300)
    expect(s.items.map(i => i.description)).toEqual(['d', 'c', 'b'])
    expect(s.dropped).toBe(1)
    expect(s.items[0].id).toBe(4)
  })

  it('TC-NS-02 去重：800ms 窗口内同 variant+description 合并（边界外不合并）', () => {
    let s = push(initialNoticeState, '同一文案', 1000)
    const same = push(s, '同一文案', 1000 + NOTICE.DEDUPE_MS - 1)
    expect(same).toBe(s)
    const outside = push(s, '同一文案', 1000 + NOTICE.DEDUPE_MS)
    expect(outside.items).toHaveLength(2)
    const otherVariant = push(s, '同一文案', 1000, 'error')
    expect(otherVariant.items).toHaveLength(2)
  })

  it('TC-NS-03 超时移除：expire 只删指定 id，其余保留', () => {
    let s = push(initialNoticeState, 'a', 1000)
    s = push(s, 'b', 1100)
    const newest = s.items[0]
    s = noticeReducer(s, { type: 'expire', id: newest.id })
    expect(s.items.map(i => i.description)).toEqual(['a'])
  })

  it('TC-NS-04 clear 复位；title 可选保留', () => {
    let s = noticeReducer(initialNoticeState, {
      type: 'push',
      payload: { variant: 'success', title: '已连接', description: '已连接到直播控制台' },
      now: 1000,
    })
    expect(s.items[0].title).toBe('已连接')
    s = noticeReducer(s, { type: 'clear' })
    expect(s).toEqual(initialNoticeState)
  })
})
