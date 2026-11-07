// B2 评论后端 · 纯解析/去重（可单测，不依赖 Electron/Playwright）
export interface BackendComment {
  /** 评论唯一 id（跨轮询去重主键） */
  id: string
  nickName: string
  content: string
  /** 毫秒时间戳（缺失时用接收到的时间） */
  at: number
  raw?: unknown
}

interface RawCommentInfo {
  comment_id?: unknown
  nick_name?: unknown
  content?: unknown
  create_time?: unknown
  [k: string]: unknown
}

/**
 * 解析 comment/info 响应体（官方 console 页 2s 轮询接口）。
 * 容错约定：非 JSON/缺 data.comment_infos → 返回 []（不抛错，交给健康探针判定）；
 * comment_id 缺失时用 index 兜底（仅本轮内唯一，去重交由调用方按 id 处理）。
 */
export function parseCommentInfos(body: string, now = Date.now()): BackendComment[] {
  if (!body) return []
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return []
  }
  const data = (json as { data?: { comment_infos?: unknown } })?.data
  const infos = data?.comment_infos
  if (!Array.isArray(infos)) return []
  const out: BackendComment[] = []
  for (let i = 0; i < infos.length; i++) {
    const c = infos[i] as RawCommentInfo
    if (!c || typeof c !== 'object') continue
    const content = typeof c.content === 'string' ? c.content.trim() : ''
    if (!content) continue
    const id =
      typeof c.comment_id === 'string' && c.comment_id
        ? c.comment_id
        : typeof c.comment_id === 'number'
          ? String(c.comment_id)
          : `idx-${i}`
    const at = typeof c.create_time === 'number' && c.create_time > 0 ? c.create_time * 1000 : now
    out.push({
      id,
      nickName: typeof c.nick_name === 'string' ? c.nick_name : '',
      content,
      at,
      raw: c,
    })
  }
  return out
}

/** 最近 N 条 id 去重器（轮询会重复返回同一批评论） */
export function createCommentDeduper(maxRemember = 500) {
  const order: string[] = []
  const seen = new Set<string>()
  return {
    /** 返回本轮新增评论（按输入顺序），重复 id 丢弃 */
    take(list: BackendComment[]): BackendComment[] {
      const fresh: BackendComment[] = []
      for (const c of list) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        order.push(c.id)
        fresh.push(c)
        if (order.length > maxRemember) {
          const old = order.shift()
          if (old) seen.delete(old)
        }
      }
      return fresh
    },
  }
}
