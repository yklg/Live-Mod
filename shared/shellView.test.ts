import { describe, expect, it } from 'vitest'
import {
  buildNoticeTestMsArg,
  buildShellViewArg,
  isShellUiView,
  parseNoticeTestMsArg,
  parseShellViewArg,
  SHELL_VIEW_ARG_PREFIX,
} from './shellView'

// ===== 壳视图参数（同步壳模式判定，shell-ui-polish v3 TC-VW-01/02）=====
// 契约：viewHost 构造 --lm-view=<name>；preload 解析未知/缺失/非法一律保守归 index（经典语义）。
describe('shellView 参数构造/解析（TC-VW-01/02）', () => {
  it('TC-VW-01 buildShellViewArg 精确构造', () => {
    expect(buildShellViewArg('rail')).toBe('--lm-view=rail')
    expect(buildShellViewArg('index')).toBe('--lm-view=index')
    expect(SHELL_VIEW_ARG_PREFIX).toBe('--lm-view=')
  })

  it('TC-VW-02a parseShellViewArg：七个合法视图名往返一致', () => {
    for (const name of [
      'index',
      'chrome',
      'rail',
      'entry',
      'notice',
      'drag',
      'assistant',
    ] as const) {
      expect(parseShellViewArg([buildShellViewArg(name)])).toBe(name)
      expect(parseShellViewArg(['electron', buildShellViewArg(name)])).toBe(name)
    }
  })

  it('TC-VW-02b parseShellViewArg：缺失/非法/畸形 → 保守 index', () => {
    expect(parseShellViewArg([])).toBe('index')
    expect(parseShellViewArg(['--no-sandbox'])).toBe('index')
    expect(parseShellViewArg(['--lm-view='])).toBe('index')
    expect(parseShellViewArg(['--lm-view=unknown'])).toBe('index')
    expect(parseShellViewArg(['--lm-view=RAIL'])).toBe('index')
    expect(parseShellViewArg(['--lm-view=rail', '--lm-view=bogus'])).toBe('rail')
  })

  it('TC-VW-03 isShellUiView：仅 index 视为经典', () => {
    expect(isShellUiView('index')).toBe(false)
    for (const name of ['chrome', 'rail', 'entry', 'notice', 'drag', 'assistant'] as const) {
      expect(isShellUiView(name)).toBe(true)
    }
  })

  it('TC-VW-04 测试时长覆盖：构造/解析/非法归 null', () => {
    expect(buildNoticeTestMsArg(300)).toBe('--lm-notice-test-ms=300')
    expect(parseNoticeTestMsArg(['x', buildNoticeTestMsArg(300)])).toBe(300)
    expect(parseNoticeTestMsArg([])).toBeNull()
    expect(parseNoticeTestMsArg(['--lm-notice-test-ms=-1'])).toBeNull()
    expect(parseNoticeTestMsArg(['--lm-notice-test-ms=abc'])).toBeNull()
    expect(parseNoticeTestMsArg(['--lm-notice-test-ms=0'])).toBeNull()
  })
})
