import { describe, expect, it } from 'vitest'
import {
  createNoticeQueue,
  enqueueNotice,
  markNoticeQueueReady,
  NOTICE_PENDING_CAP,
  resetNoticeQueue,
} from '#/windows/noticeQueue'

// ===== 通知传输队列纯 reducer（shell-ui-polish v3 · TC-NB-01~04）=====
// 契约：未就绪缓冲 cap 20 淘汰最旧；ready 后按原序冲刷一次；重复 ready 幂等；reset 清空。
const payload = (n: number): NoticePayload => ({ variant: 'info', description: `n${n}` })

describe('noticeQueue（TC-NB-01~04）', () => {
  it('TC-NB-01 未就绪缓冲 cap 20，超出淘汰最旧并累计 dropped', () => {
    let state = createNoticeQueue()
    for (let i = 0; i < NOTICE_PENDING_CAP + 3; i++) state = enqueueNotice(state, payload(i))
    expect(state.pending).toHaveLength(NOTICE_PENDING_CAP)
    expect(state.pending[0]).toEqual(payload(3))
    expect(state.pending.at(-1)).toEqual(payload(NOTICE_PENDING_CAP + 2))
    expect(state.dropped).toBe(3)
  })

  it('TC-NB-02 ready 后按原序冲刷一次，且后续 enqueue 不再入队', () => {
    let state = createNoticeQueue()
    state = enqueueNotice(state, payload(1))
    state = enqueueNotice(state, payload(2))
    const { state: next, flush } = markNoticeQueueReady(state)
    expect(flush).toEqual([payload(1), payload(2)])
    state = next
    expect(state.ready).toBe(true)
    expect(state.pending).toEqual([])
    const again = enqueueNotice(state, payload(3))
    expect(again.pending).toEqual([])
  })

  it('TC-NB-03 重复 ready 幂等（第二次 flush 为空）', () => {
    let state = createNoticeQueue()
    state = enqueueNotice(state, payload(1))
    state = markNoticeQueueReady(state).state
    const second = markNoticeQueueReady(state)
    expect(second.flush).toEqual([])
    expect(second.state).toBe(state)
  })

  it('TC-NB-04 reset 清空缓冲与就绪态（窗口关闭/重启路径）', () => {
    let state = createNoticeQueue()
    state = enqueueNotice(state, payload(1))
    state = markNoticeQueueReady(state).state
    const reset = resetNoticeQueue()
    expect(reset).toEqual({ ready: false, pending: [], dropped: 0 })
    expect(reset).not.toBe(state)
  })
})
