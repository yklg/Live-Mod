// 评论顺序唯一真源：主进程 CommentStore 与渲染层 mergeComments 必须共用同一比较器。
// 若两处各写一份，store 降序 + merge 升序 ⇒ 面板顺序颠倒，而两条单测都绿（不易察觉的错序）。
// 用 `<`/`>` 而非 localeCompare：结果与 locale 无关，跨环境确定。

export interface CommentOrderKey {
  at: number
  id: string
}

/** 升序（旧→新）；`at` 相同时按 id 字典序，保证同毫秒评论顺序稳定 */
export function compareByAtThenId(a: CommentOrderKey, b: CommentOrderKey): number {
  if (a.at !== b.at) return a.at - b.at
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** 非破坏性排序：返回新数组，入参不变 */
export function sortComments<T extends CommentOrderKey>(list: readonly T[]): T[] {
  return [...list].sort(compareByAtThenId)
}
