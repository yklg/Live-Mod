// 工作区模式唯一状态机（第二期）：纯函数，零 Electron import。
// 只负责 mode 迁移；dock 开合/宽度仍归 panelController，几何归 shellLayout。
import type { WorkspaceMode } from './shellLayout'

const MODES: readonly WorkspaceMode[] = ['workbench', 'live', 'browse']

export interface WorkspaceModeController {
  mode(): WorkspaceMode
  set(next: WorkspaceMode): boolean
  enterWorkbench(): boolean
  enterLive(): boolean
  enterBrowse(): boolean
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

export function createWorkspaceMode(
  initial: WorkspaceMode = 'workbench',
  onChange?: (mode: WorkspaceMode) => void,
): WorkspaceModeController {
  let mode: WorkspaceMode = initial
  const set = (next: WorkspaceMode) => {
    if (!isWorkspaceMode(next)) return false
    if (next === mode) return false
    mode = next
    onChange?.(mode)
    return true
  }
  return {
    mode: () => mode,
    set,
    enterWorkbench: () => set('workbench'),
    enterLive: () => set('live'),
    enterBrowse: () => set('browse'),
  }
}
