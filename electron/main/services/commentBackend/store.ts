// B2 评论事实存储（W1）：纯内存、无 Electron 依赖、写读端口分离。
//
// 为什么要在主进程存：评论是业务事实，此前只存在 LiveInteraction 组件内存里（重挂载即丢）。
// 端口分离的目的不是"分层好看"，而是让「谁能写」在类型层面唯一 —— writer 只交给 AccountSession，
// reader 交给 IPC 聚合与任务层；渲染层拿不到 writer，就不可能发明第二条写入路径。
//
// 容量语义（两层，别混）：
//   - 存储上限：每账号 perAccountLimit(200)、全局 totalLimit(500)
//   - 对外展示：snapshot(limitPerAccount) 由调用方给（IPC 固定 100）
// 淘汰是**不可逆丢失**，因此必须打 stderr（不走 logger：logger 自身经 windowManager 推送，
// 在传输层故障时会递归）。同一次 append 调用内至多 1 条，避免刷屏。

import { sortComments } from 'shared/commentOrder'
import type { BackendComment, CommentBackendStatus } from './contracts'

export interface StoredComment extends BackendComment {
  accountId: string
}

export interface CommentStoreSnapshot {
  accounts: Array<{ accountId: string; status: CommentBackendStatus; comments: StoredComment[] }>
}

/** 写端口：仅 AccountSession 持有 */
export interface CommentWriter {
  /** 返回本次真正新增的评论（已去重）；被淘汰的条目不回传，只进 stderr */
  append(accountId: string, comments: readonly BackendComment[]): BackendComment[]
  setStatus(accountId: string, status: CommentBackendStatus): void
  clear(accountId: string): void
}

/** 读端口：IPC / 聚合使用（无写方法） */
export interface CommentReader {
  list(accountId: string, limit?: number): StoredComment[]
  snapshot(limitPerAccount: number): CommentStoreSnapshot
  size(): number
}

export interface CommentStoreOptions {
  /** 每账号环形缓冲上限，默认 200 */
  perAccountLimit?: number
  /** 全局条数上限（跨账号淘汰最旧），默认 500 */
  totalLimit?: number
  /** 淘汰告警输出口，默认 process.stderr（单测注入以断言限频） */
  writeStderr?: (line: string) => void
}

const DEFAULT_PER_ACCOUNT = 200
const DEFAULT_TOTAL = 500

const IDLE_STATUS: CommentBackendStatus = { state: 'idle', comments: 0 }

interface Bucket {
  status: CommentBackendStatus
  comments: StoredComment[]
  seen: Set<string>
}

export function createCommentStore(opts: CommentStoreOptions = {}): {
  writer: CommentWriter
  reader: CommentReader
} {
  const perAccountLimit = opts.perAccountLimit ?? DEFAULT_PER_ACCOUNT
  const totalLimit = opts.totalLimit ?? DEFAULT_TOTAL
  const writeStderr = opts.writeStderr ?? ((line: string) => void process.stderr.write(line))

  const buckets = new Map<string, Bucket>()
  let total = 0

  function bucketOf(accountId: string): Bucket {
    let b = buckets.get(accountId)
    if (!b) {
      b = { status: { ...IDLE_STATUS }, comments: [], seen: new Set() }
      buckets.set(accountId, b)
    }
    return b
  }

  /** 全局淘汰：各账号队首里挑 `at` 最小者（FIFO 兜底，防 at 乱序时淘汰错人） */
  function evictOldest(): StoredComment | undefined {
    let victimAccount: string | undefined
    let victim: StoredComment | undefined
    for (const [accountId, b] of buckets) {
      const head = b.comments[0]
      if (!head) continue
      if (!victim || head.at < victim.at) {
        victim = head
        victimAccount = accountId
      }
    }
    if (!victim || victimAccount === undefined) return undefined
    const b = buckets.get(victimAccount)!
    b.comments.shift()
    b.seen.delete(victim.id)
    total--
    return victim
  }

  function append(accountId: string, comments: readonly BackendComment[]): BackendComment[] {
    const b = bucketOf(accountId)
    const added: BackendComment[] = []

    for (const c of comments) {
      if (!c || typeof c.id !== 'string' || c.id === '') continue
      if (b.seen.has(c.id)) continue
      b.seen.add(c.id)
      // 防御性拷贝：调用方后续 mutate 入参不应污染存储
      b.comments.push({ ...c, accountId })
      total++
      added.push(c)
    }

    const evicted: StoredComment[] = []

    while (b.comments.length > perAccountLimit) {
      const out = b.comments.shift()
      if (!out) break
      b.seen.delete(out.id)
      total--
      evicted.push(out)
    }

    while (total > totalLimit) {
      const out = evictOldest()
      if (!out) break
      evicted.push(out)
    }

    if (evicted.length > 0) {
      const ids = evicted
        .slice(0, 5)
        .map(c => c.id)
        .join(',')
      const more = evicted.length > 5 ? `,…(+${evicted.length - 5})` : ''
      writeStderr(
        `[commentStore] 淘汰 ${evicted.length} 条（perAccount=${perAccountLimit}, total=${totalLimit}）: ${ids}${more}\n`,
      )
    }

    return added
  }

  const writer: CommentWriter = {
    append,
    setStatus(accountId, status) {
      bucketOf(accountId).status = status
    },
    clear(accountId) {
      const b = buckets.get(accountId)
      if (!b) return
      total -= b.comments.length
      buckets.delete(accountId)
    },
  }

  const reader: CommentReader = {
    list(accountId, limit) {
      const b = buckets.get(accountId)
      if (!b) return []
      // 对象级拷贝：只拷贝数组不够 —— 元素仍是内部引用，外部改 content 会回写存储（TC-CS7）
      const sorted = sortComments(b.comments).map(x => ({ ...x }))
      return typeof limit === 'number' && limit >= 0 ? sorted.slice(-limit) : sorted
    },
    snapshot(limitPerAccount) {
      const accounts: CommentStoreSnapshot['accounts'] = []
      for (const [accountId, b] of buckets) {
        const sorted = sortComments(b.comments).map(x => ({ ...x }))
        const comments = limitPerAccount >= 0 ? sorted.slice(-limitPerAccount) : sorted
        accounts.push({ accountId, status: { ...b.status }, comments })
      }
      return { accounts }
    },
    size() {
      return total
    },
  }

  return { writer, reader }
}

/**
 * 主进程唯一实例：AccountSession 持有 writer 写入、IPC 层用 reader 出快照、AccountManager 在
 * 会话关闭时清理。单测请用 `createCommentStore()` 构造独立实例，不要共享这个单例。
 */
export const commentStore = createCommentStore()
