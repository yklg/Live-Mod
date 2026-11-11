// 壳运行态共享契约（主进程 shellUI ↔ chrome 渲染层）
// 只承载 chrome 需要的模式；dock 宽度/场次等运行细节留在主进程。
export type ShellMode = 'entry' | 'live' | 'browse'

export interface ShellChromeState {
  mode: ShellMode
  /**
   * 顶栏悬浮菜单是否打开（壳 v3 · 菜单失焦收起）。
   * chrome 用它判断「点顶栏其它区域」是否应关闭菜单；菜单本体在 rail 视图。
   */
  menuOpen: boolean
}

export const DEFAULT_SHELL_CHROME_STATE: ShellChromeState = {
  mode: 'entry',
  menuOpen: false,
}
