// 壳模式状态机（纯逻辑）：entry / live / browse，默认 entry。
import type { ShellMode } from './shellLayout'

const MODES: readonly ShellMode[] = ['entry', 'live', 'browse']

export interface ShellModeController {
  mode(): ShellMode
  set(next: ShellMode): boolean
}

export function isShellMode(value: unknown): value is ShellMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

/**
 * 模式派生（壳 v3 合并）：非 entry 时 mode 不再由用户开关决定，
 * 而是「当前 active Tab 属于哪条表面」的结果。
 * - account（官方中控台）→ live
 * - free / popup（自由浏览）→ browse
 */
export function shellModeForTabKind(kind: 'account' | 'free' | 'popup'): 'live' | 'browse' {
  return kind === 'account' ? 'live' : 'browse'
}

export function createShellMode(
  initial: ShellMode = 'entry',
  onChange?: (mode: ShellMode) => void,
): ShellModeController {
  let mode: ShellMode = initial
  const set = (next: ShellMode) => {
    if (!isShellMode(next)) return false
    if (next === mode) return true
    mode = next
    onChange?.(mode)
    return true
  }
  return { mode: () => mode, set }
}
