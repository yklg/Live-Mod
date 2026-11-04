import { describe, expect, it, vi } from 'vitest'

// LogDisplayer 的依赖链（useIpc）在模块顶层访问 window.ipcRenderer，
// node 测试环境用内存桩替代
vi.stubGlobal('window', {
  ipcRenderer: { on: vi.fn(() => vi.fn()), invoke: vi.fn(), send: vi.fn() },
})

const { parseLogMessage } = await import('./LogDisplayer')

type LogMessageParam = Parameters<typeof parseLogMessage>[0]

const makeLog = (overrides: Partial<LogMessageParam> = {}): LogMessageParam =>
  ({
    date: new Date('2026-01-01T12:00:00'),
    level: 'info',
    data: ['hello'],
    ...overrides,
  }) as LogMessageParam

describe('parseLogMessage 日志解析（TC-11）', () => {
  it('TC-11.1 [IN-06] 正常消息：level 转大写、scope 作为模块名', () => {
    const parsed = parseLogMessage(makeLog({ level: 'warn', scope: '中控台' }))
    expect(parsed).not.toBeNull()
    expect(parsed?.level).toBe('WARN')
    expect(parsed?.module).toBe('中控台')
    expect(parsed?.message).toBe('hello')
    expect(typeof parsed?.timestamp).toBe('string')
  })

  it('TC-11.2 [IN-01] 空 data 数组返回 null', () => {
    expect(parseLogMessage(makeLog({ data: [] }))).toBeNull()
  })

  it('TC-11.3 [IN-01] data 缺失返回 null', () => {
    expect(parseLogMessage(makeLog({ data: undefined }))).toBeNull()
  })

  it('TC-11.4 [IN-02] 多行消息只保留第一行', () => {
    const parsed = parseLogMessage(makeLog({ data: ['first line\nsecond line'] }))
    expect(parsed?.message).toBe('first line')
  })

  it('TC-11.5 [IN-06] 多参数以空格拼接', () => {
    const parsed = parseLogMessage(makeLog({ data: ['a', 'b', 'c'] }))
    expect(parsed?.message).toBe('a b c')
  })

  it('TC-11.6 [IN-04] level 为非字符串（数字）时回退为 INFO', () => {
    const parsed = parseLogMessage(makeLog({ level: 3 as never }))
    expect(parsed?.level).toBe('INFO')
  })

  it('TC-11.7 [IN-01] scope 缺失回退为 App', () => {
    const parsed = parseLogMessage(makeLog({ scope: undefined }))
    expect(parsed?.module).toBe('App')
  })

  it('TC-11.8 [INV-01] 每条日志生成唯一 id', () => {
    const a = parseLogMessage(makeLog())
    const b = parseLogMessage(makeLog())
    expect(a?.id).not.toBe(b?.id)
  })
})
