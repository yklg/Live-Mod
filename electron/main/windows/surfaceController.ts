// 壳表面转移纯函数：所有模式变更的唯一决策源（无 Electron import）。
// shellUI 只执行 plan 的副作用；单元测试直接断言 plan。

import type { ShellMode } from './shellLayout'

export interface SurfaceOptions {
  /** entry 模式点业务图标：进 live 并打开指定 dock route。 */
  openDockRoute?: string | null
  /** autoRestore 命中：恢复上次 dock。 */
  restoreDock?: boolean
}

export interface SurfacePlan {
  mode: ShellMode
  entryVisible: boolean
  closeDock: boolean
  ensureTab: 'account' | 'free' | null
  restoreDock: boolean
  openDockRoute: string | null
}

export function planSurface(mode: ShellMode, opts: SurfaceOptions = {}): SurfacePlan {
  if (mode === 'entry') {
    return {
      mode,
      entryVisible: true,
      closeDock: true,
      ensureTab: null,
      restoreDock: false,
      openDockRoute: null,
    }
  }
  return {
    mode,
    entryVisible: false,
    closeDock: false,
    ensureTab: mode === 'live' ? 'account' : 'free',
    restoreDock: mode === 'live' && opts.restoreDock === true,
    openDockRoute: opts.openDockRoute ?? null,
  }
}
