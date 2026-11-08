import { describe, expect, it } from 'vitest'
import { mergeComments } from './mergeComments'

// ===== 评论合并契约（W4 · TC-MG1~MG7）=====
// 守护不变量：
//   C-MG1 同一 (accountId, id) 只保留 1 条
//   C-MG2 不同账号的同名 id 必须都保留（裸 id 去重 = 跨账号丢评论）
//   C-MG3 升序（旧→新），同 at 按 id 定序 —— 顺序必须稳定，不能依赖输入顺序
//   C-MG4 超限保留最新 N 条
//   C-MG5 「先订阅后快照」的重复能在合并时消掉，且不漏条目
//   C-MG6 纯函数：不 mutate 入参
//   C-MG7 不依赖时钟/window（同入参同出参）

const c = (id: string, at: number, accountId = 'a', content = `c-${id}`) => ({
  id,
  nickName: 'u',
  content,
  at,
  accountId,
})

describe('mergeComments（TC-MG1~MG7）', () => {
  it('TC-MG1 同一账号同一 id 只保留 1 条', () => {
    const base = [c('1', 1000)]
    const incoming = [c('1', 1000)]

    const merged = mergeComments(base, incoming)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('1')
  })

  it('TC-MG2 不同账号的同 id 必须都保留', () => {
    const merged = mergeComments([c('1', 1000, 'a')], [c('1', 2000, 'b')])

    expect(merged).toHaveLength(2)
    expect(merged.map(x => x.accountId)).toEqual(['a', 'b'])
  })

  it('TC-MG3 乱序输入按 at 升序；同 at 按 id 定序（稳定、与输入顺序无关）', () => {
    const first = mergeComments([], [c('3', 3000), c('1', 1000), c('2', 2000)])
    const second = mergeComments([], [c('2', 2000), c('3', 3000), c('1', 1000)])

    expect(first.map(x => x.id)).toEqual(['1', '2', '3'])
    expect(second.map(x => x.id)).toEqual(['1', '2', '3'])

    // 同 at 的两条：id 字典序（b < c）
    const tie = mergeComments([], [c('c', 5000), c('b', 5000)])
    expect(tie.map(x => x.id)).toEqual(['b', 'c'])
  })

  it('TC-MG4 超限保留最新 N 条（limit 生效且仍是升序）', () => {
    const many = Array.from({ length: 150 }, (_, i) => c(`id-${i}`, i * 1000))
    const merged = mergeComments([], many, 100)

    expect(merged).toHaveLength(100)
    expect(merged[0].id).toBe('id-50')
    expect(merged.at(-1)?.id).toBe('id-149')
    expect(merged.map(x => x.at)).toEqual([...merged.map(x => x.at)].sort((a, b) => a - b))
  })

  it('TC-MG5 先订阅后快照：重叠部分去重，快照独有条目不丢', () => {
    // 订阅期间已推来 3 条
    const streaming = [c('s1', 1000), c('s2', 2000), c('s3', 3000)]
    // 快照包含这 3 条 + 之前历史 7 条
    const snapshot = [
      ...Array.from({ length: 7 }, (_, i) => c(`h${i}`, -7000 + i * 1000)),
      ...streaming,
    ]

    const merged = mergeComments(streaming, snapshot)
    expect(merged).toHaveLength(10)
    const ids = merged.map(x => x.id)
    expect(new Set(ids).size).toBe(10)
    expect(ids.slice(0, 7)).toEqual(['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
  })

  it('TC-MG6 空输入返回空数组，且不修改入参', () => {
    const base = Object.freeze([c('1', 1000)])
    const incoming = Object.freeze([c('2', 2000)])

    const merged = mergeComments(base, incoming)
    expect(merged).toHaveLength(2)
    expect(base).toHaveLength(1)
    expect(incoming).toHaveLength(1)
    expect(mergeComments([], [])).toEqual([])
  })

  it('TC-MG7 纯函数：同入参两次调用结果一致（不依赖时钟/全局态）', () => {
    const base = [c('1', 1000)]
    const incoming = [c('2', 2000)]

    expect(mergeComments(base, incoming)).toEqual(mergeComments(base, incoming))
  })
})
