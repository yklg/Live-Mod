// 壳运行态共享契约（主进程 shellUI ↔ chrome 渲染层）
// 只承载 chrome 需要的模式；dock 宽度/场次等运行细节留在主进程。
export type ShellMode = 'entry' | 'live' | 'browse'

export interface ShellChromeState {
  mode: ShellMode
}

export const DEFAULT_SHELL_CHROME_STATE: ShellChromeState = {
  mode: 'entry',
}
