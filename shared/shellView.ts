// 壳视图参数（viewHost 注入 renderer argv；preload 同步解析）
// 目的：壳模式判定必须在渲染层任何模块执行前就确定（useToast 是模块级同步函数），
// 异步 invoke(shell.uiStatus) 会把启动期通知漏进已被裁剪的 rail Toaster（真实缺陷根因）。
export const SHELL_VIEW_ARG_PREFIX = '--lm-view='
/** 通知停留时长测试覆盖（仅测试/调试口径，由主进程按 env 注入 notice 视图 argv） */
export const NOTICE_TEST_MS_ARG_PREFIX = '--lm-notice-test-ms='

const SHELL_VIEW_NAMES: readonly ShellViewName[] = [
  'index',
  'chrome',
  'rail',
  'entry',
  'notice',
  'drag',
  'assistant',
]

export function isShellViewName(value: string): value is ShellViewName {
  return (SHELL_VIEW_NAMES as readonly string[]).includes(value)
}

export function buildShellViewArg(viewName: ShellViewName): string {
  return `${SHELL_VIEW_ARG_PREFIX}${viewName}`
}

/** 未知/缺失/非法一律保守归 index（经典模式已移除：该值仅作历史参数兼容，永不产生壳 UI 语义） */
export function parseShellViewArg(argv: readonly string[]): ShellViewName {
  for (const arg of argv) {
    if (!arg.startsWith(SHELL_VIEW_ARG_PREFIX)) continue
    const value = arg.slice(SHELL_VIEW_ARG_PREFIX.length)
    return isShellViewName(value) ? value : 'index'
  }
  return 'index'
}

/** 壳 UI = 非 index 入口（chrome/rail/entry/notice 均属壳 UI 视图） */
export function isShellUiView(viewName: ShellViewName): boolean {
  return viewName !== 'index'
}

export function buildNoticeTestMsArg(ms: number): string {
  return `${NOTICE_TEST_MS_ARG_PREFIX}${Math.max(0, Math.floor(ms))}`
}

/** 解析测试时长覆盖；非法/缺失返回 null（生产无覆盖） */
export function parseNoticeTestMsArg(argv: readonly string[]): number | null {
  for (const arg of argv) {
    if (!arg.startsWith(NOTICE_TEST_MS_ARG_PREFIX)) continue
    const value = Number(arg.slice(NOTICE_TEST_MS_ARG_PREFIX.length))
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return null
}
