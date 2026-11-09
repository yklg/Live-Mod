import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_HISTORY_FILE,
  LIVE_HISTORY_LIMIT,
  LiveHistoryStore,
  parseLiveHistory,
} from '#/services/LiveHistoryStore'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getAppPath: vi.fn(() => '/mock/app'),
  },
}))

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-live-history-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const make = () => new LiveHistoryStore({ path: path.join(dir, LIVE_HISTORY_FILE) })

describe('LiveHistoryStore', () => {
  it('start → live；end → ended；重复 end 只改一次', () => {
    const s = make()
    s.recordStart('a', 'douyin', 1000)
    expect(s.snapshot().sessions[0]).toMatchObject({
      accountId: 'a',
      platform: 'douyin',
      status: 'live',
      endedAt: null,
    })
    const ended = s.recordEnd('a', 2000)
    expect(ended.sessions[0]).toMatchObject({ status: 'ended', endedAt: 2000 })
    const again = s.recordEnd('a', 3000)
    expect(again.sessions[0].endedAt).toBe(2000)
  })

  it('同账号重新 start 会把旧 live 标 interrupted', () => {
    const s = make()
    s.recordStart('a', 'douyin', 1000)
    s.recordStart('a', 'douyin', 2000)
    const sessions = s.snapshot().sessions
    expect(sessions).toHaveLength(2)
    expect(sessions.find(x => x.startedAt === 1000)?.status).toBe('interrupted')
    expect(sessions.find(x => x.startedAt === 2000)?.status).toBe('live')
  })

  it('markInterrupted 清理悬挂 live', () => {
    const s = make()
    s.recordStart('a', 'douyin', 1000)
    const out = s.markInterrupted(5000)
    expect(out.sessions[0]).toMatchObject({ status: 'interrupted', endedAt: 5000 })
  })

  it('最多保留 20 条', () => {
    const s = make()
    for (let i = 0; i < LIVE_HISTORY_LIMIT + 5; i++) s.recordStart(`a${i}`, 'douyin', 1000 + i)
    expect(s.snapshot().sessions).toHaveLength(LIVE_HISTORY_LIMIT)
  })

  it('损坏文件回空；非法条目整体拒绝', () => {
    expect(parseLiveHistory('broken')).toBeNull()
    expect(parseLiveHistory(JSON.stringify({ version: 1, sessions: [{ id: 1 }] }))).toBeNull()
    const badFile = path.join(dir, LIVE_HISTORY_FILE)
    fs.writeFileSync(badFile, 'broken')
    expect(make().snapshot().sessions).toEqual([])
  })

  it('持久化往返', () => {
    const file = path.join(dir, LIVE_HISTORY_FILE)
    const s = make()
    s.recordStart('a', 'douyin', 1000)
    s.recordEnd('a', 2000)
    const reloaded = new LiveHistoryStore({ path: file }).snapshot()
    expect(reloaded.sessions[0]).toMatchObject({ accountId: 'a', endedAt: 2000 })
  })
})
