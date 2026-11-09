// 最近直播场次（userData/live-history.json）· 主进程只读真源。
// 记录由 LiveSessionRecorder 写入；workspace 首页只读。
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { LiveHistorySnapshot, LiveSession } from 'shared/liveHistory'

export const LIVE_HISTORY_FILE = 'live-history.json'
export const LIVE_HISTORY_VERSION = 1
export const LIVE_HISTORY_LIMIT = 20

interface StoredHistory extends LiveHistorySnapshot {
  version: number
}

const DEFAULT: StoredHistory = { version: LIVE_HISTORY_VERSION, sessions: [] }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseLiveHistory(raw: string | null): StoredHistory | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.version !== LIVE_HISTORY_VERSION) return null
  if (!Array.isArray(data.sessions)) return null
  const sessions: LiveSession[] = []
  for (const s of data.sessions) {
    if (!isRecord(s)) return null
    if (
      typeof s.id !== 'string' ||
      typeof s.accountId !== 'string' ||
      typeof s.platform !== 'string' ||
      typeof s.startedAt !== 'number' ||
      !(s.endedAt === null || typeof s.endedAt === 'number') ||
      !['live', 'ended', 'interrupted'].includes(s.status as string)
    ) {
      return null
    }
    sessions.push({
      id: s.id,
      accountId: s.accountId,
      platform: s.platform,
      startedAt: s.startedAt,
      endedAt: s.endedAt as number | null,
      status: s.status as LiveSession['status'],
    })
  }
  return { version: LIVE_HISTORY_VERSION, sessions: sessions.slice(0, LIVE_HISTORY_LIMIT) }
}

export class LiveHistoryStore {
  private state: StoredHistory = { ...DEFAULT, sessions: [] }
  private loaded = false
  private readonly filePath: string
  private readonly readFile: (p: string) => string | null
  private readonly writeFile: (p: string, d: string) => void

  constructor(
    opts: {
      path?: string
      readFile?: (p: string) => string | null
      writeFile?: (p: string, d: string) => void
    } = {},
  ) {
    this.filePath = opts.path ?? path.join(app.getPath('userData'), LIVE_HISTORY_FILE)
    this.readFile =
      opts.readFile ??
      (p => {
        try {
          return fs.readFileSync(p, 'utf-8')
        } catch {
          return null
        }
      })
    this.writeFile =
      opts.writeFile ??
      ((p, d) => {
        const tmp = `${p}.tmp`
        fs.writeFileSync(tmp, d, 'utf-8')
        fs.renameSync(tmp, p)
      })
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    this.state = parseLiveHistory(this.readFile(this.filePath)) ?? { ...DEFAULT, sessions: [] }
  }

  snapshot(): LiveHistorySnapshot {
    this.load()
    return { sessions: this.state.sessions.map(s => ({ ...s })) }
  }

  private commit(next: LiveHistorySnapshot) {
    this.load()
    const sessions = next.sessions.slice(0, LIVE_HISTORY_LIMIT)
    try {
      this.writeFile(
        this.filePath,
        JSON.stringify(
          { version: LIVE_HISTORY_VERSION, sessions } satisfies StoredHistory,
          null,
          2,
        ),
      )
    } catch {
      // 历史记录非关键数据：写失败保留内存态，不阻断业务
    }
    this.state = { version: LIVE_HISTORY_VERSION, sessions }
  }

  recordStart(accountId: string, platform: string, startedAt = Date.now()): LiveHistorySnapshot {
    this.load()
    const sessions = this.state.sessions.map(s =>
      s.accountId === accountId && s.status === 'live'
        ? { ...s, status: 'interrupted' as const, endedAt: startedAt }
        : s,
    )
    const id = `${accountId}:${startedAt}`
    if (!sessions.some(s => s.id === id)) {
      sessions.unshift({ id, accountId, platform, startedAt, endedAt: null, status: 'live' })
    }
    this.commit({ sessions })
    return this.snapshot()
  }

  recordEnd(
    accountId: string,
    endedAt = Date.now(),
    status: 'ended' | 'interrupted' = 'ended',
  ): LiveHistorySnapshot {
    this.load()
    let changed = false
    const sessions = this.state.sessions.map(s => {
      if (!changed && s.accountId === accountId && s.status === 'live') {
        changed = true
        return { ...s, endedAt, status }
      }
      return s
    })
    if (changed) this.commit({ sessions })
    return this.snapshot()
  }

  markInterrupted(at = Date.now()): LiveHistorySnapshot {
    this.load()
    let changed = false
    const sessions = this.state.sessions.map(s => {
      if (s.status === 'live') {
        changed = true
        return { ...s, status: 'interrupted' as const, endedAt: s.endedAt ?? at }
      }
      return s
    })
    if (changed) this.commit({ sessions })
    return this.snapshot()
  }
}

export const liveHistoryStore = new LiveHistoryStore()
