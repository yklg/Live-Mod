import { describe, expect, it } from 'vitest'
import { createCommentStore } from '#/services/commentBackend/store'

// ===== CommentStore 契约（W1 · TC-CS1~CS8）=====
// 守护不变量：
//   C-CS1 同 id 重复写入只保留 1 条，且返回值只含真正新增
//   C-CS2 单账号超上限按到达顺序淘汰最旧，且**打 1 条 stderr**（不可逆丢失不许静默）
//   C-CS3 全局超上限跨账号淘汰最旧（per-account 与 total 是两层，别只测一层）
//   C-CS4 clear 只清目标账号
//   C-CS5 快照按账号分组、按 limit 截断、**升序（旧→新）**，与 mergeComments 同源比较器
//   C-CS6 读写端口分离：reader 上不存在任何写方法
//   C-CS7 快照/列表返回副本，外部篡改不回写
//   C-CS8 入参数组后续 mutate 不污染存储（防御性拷贝）

const c = (id: string, at: number, content = `c-${id}`) => ({
  id,
  nickName: 'u',
  content,
  at,
})

/** 注入 stderr 收集器（不读控制台文本，避免与 vitest reporter 互相干扰） */
function makeStore(opts: { perAccountLimit?: number; totalLimit?: number } = {}) {
  const lines: string[] = []
  const store = createCommentStore({
    ...opts,
    writeStderr: (line: string) => void lines.push(line),
  })
  return { ...store, lines }
}

describe('CommentStore（TC-CS1~CS8）', () => {
  it('TC-CS1 同 id 重复 append 只保留 1 条，返回值只含真正新增', () => {
    const { writer, reader } = makeStore()

    const first = writer.append('a', [c('1', 1000), c('2', 2000)])
    const second = writer.append('a', [c('2', 2000), c('3', 3000)])

    expect(first.map(x => x.id)).toEqual(['1', '2'])
    expect(second.map(x => x.id)).toEqual(['3'])
    expect(reader.list('a').map(x => x.id)).toEqual(['1', '2', '3'])
  })

  it('TC-CS2 单账号 201 条 → 保留最新 200，stderr 恰 1 条', () => {
    const { writer, reader, lines } = makeStore({ perAccountLimit: 200 })

    const batch = Array.from({ length: 201 }, (_, i) => c(`id-${i}`, i * 1000))
    writer.append('a', batch)

    const list = reader.list('a')
    expect(list).toHaveLength(200)
    // 最旧的那条被淘汰
    expect(list.some(x => x.id === 'id-0')).toBe(false)
    expect(list[0].id).toBe('id-1')
    expect(list.at(-1)?.id).toBe('id-200')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('淘汰 1 条')
  })

  it('TC-CS3 三账号各 200 条（总 600）→ 全局淘汰至 500，淘汰最旧', () => {
    const { writer, reader, lines } = makeStore({ perAccountLimit: 200, totalLimit: 500 })

    // a 最旧、b 居中、c 最新（at 单调递增，跨账号可比）
    writer.append(
      'a',
      Array.from({ length: 200 }, (_, i) => c(`a-${i}`, i)),
    )
    writer.append(
      'b',
      Array.from({ length: 200 }, (_, i) => c(`b-${i}`, 1000 + i)),
    )
    writer.append(
      'c',
      Array.from({ length: 200 }, (_, i) => c(`c-${i}`, 2000 + i)),
    )

    expect(reader.size()).toBe(500)
    // 最旧的 100 条（a-0..a-99）被淘汰
    expect(reader.list('a')).toHaveLength(100)
    expect(reader.list('a')[0].id).toBe('a-100')
    expect(reader.list('b')).toHaveLength(200)
    expect(reader.list('c')).toHaveLength(200)
    expect(lines).toHaveLength(1)
  })

  it('TC-CS4 clear 只清目标账号，其它账号与总数同步', () => {
    const { writer, reader } = makeStore()
    writer.append('a', [c('1', 1)])
    writer.append('b', [c('2', 2), c('3', 3)])

    writer.clear('a')

    expect(reader.list('a')).toEqual([])
    expect(reader.list('b').map(x => x.id)).toEqual(['2', '3'])
    expect(reader.size()).toBe(2)
  })

  it('TC-CS5 快照按账号分组、按 limit 截断、升序（旧→新）', () => {
    const { writer, reader } = makeStore()
    // 故意乱序写入：排序必须由比较器保证，而不是靠写入顺序
    writer.append('a', [c('3', 3000), c('1', 1000), c('2', 2000)])
    writer.append('b', [c('9', 9000)])

    const snap = reader.snapshot(2)

    expect(snap.accounts.map(x => x.accountId)).toEqual(['a', 'b'])
    expect(snap.accounts[0].comments.map(x => x.id)).toEqual(['2', '3']) // 截断保留最新 2 条且升序
    expect(snap.accounts[1].comments.map(x => x.id)).toEqual(['9'])
  })

  it('TC-CS6 读写端口分离：reader 上不存在任何写方法', () => {
    const { reader } = makeStore()
    const keys = Object.keys(reader)
    expect(keys).not.toContain('append')
    expect(keys).not.toContain('setStatus')
    expect(keys).not.toContain('clear')
  })

  it('TC-CS7 快照与列表均为副本，外部篡改不回写内部状态', () => {
    const { writer, reader } = makeStore()
    writer.append('a', [c('1', 1)])

    const list = reader.list('a')
    list.push(c('999', 999) as never)
    list[0].content = 'tampered'

    const snap = reader.snapshot(10)
    snap.accounts[0].comments.length = 0
    snap.accounts[0].status.state = 'error'

    expect(reader.list('a').map(x => x.id)).toEqual(['1'])
    expect(reader.list('a')[0].content).toBe('c-1')
    expect(reader.snapshot(10).accounts[0].status.state).toBe('idle')
  })

  it('TC-CS8 append 入参后续 mutate 不污染存储', () => {
    const { writer, reader } = makeStore()
    const input = [c('1', 1)]
    writer.append('a', input)

    input[0].content = 'mutated-later'
    input.push(c('2', 2))

    expect(reader.list('a')).toHaveLength(1)
    expect(reader.list('a')[0].content).toBe('c-1')
  })
})
