// 评论合并纯函数（W4）：把「实时流」与「主进程快照」合成一个稳定列表。
//
// 为什么需要它：先注册监听再 invoke(getState) 是正确时序（不漏事件），但两条来源必然重叠 ——
// 快照里包含订阅期间已经推来的评论。所以必须去重，且去重键不能只用 id：
// 多账号下不同账号可能有相同 id（官方 comment_id 只在单场直播内唯一），裸 id 去重会跨账号误删（P2-9 同源）。
//
// 排序必须与主进程 CommentStore 共用比较器（shared/commentOrder）：两处各写一份的话，
// 一边升序一边降序会让面板顺序颠倒，而两条单测都还是绿的。
import { sortComments } from 'shared/commentOrder'

export interface CommentItem {
  id: string
  nickName: string
  content: string
  at: number
  accountId?: string
}

/** 默认展示上限（与主进程 HISTORY_LIMIT 对齐） */
export const MERGE_LIMIT = 100

function keyOf(c: CommentItem): string {
  // 用 NUL 分隔，避免 accountId/id 里出现分隔符导致键碰撞
  return `${c.accountId ?? ''}\u0000${c.id}`
}

/**
 * @param base 已在列表中的条目（实时流已到达的）
 * @param incoming 后到的条目（快照或新推送）
 * @returns 去重 + 升序（旧→新）+ 保留最新 limit 条的新数组；入参不被修改
 */
export function mergeComments(
  base: readonly CommentItem[],
  incoming: readonly CommentItem[],
  limit = MERGE_LIMIT,
): CommentItem[] {
  const seen = new Set<string>()
  const merged: CommentItem[] = []

  for (const c of [...base, ...incoming]) {
    if (!c || typeof c.id !== 'string') continue
    const key = keyOf(c)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }

  const sorted = sortComments(merged)
  return limit >= 0 ? sorted.slice(-limit) : sorted
}
