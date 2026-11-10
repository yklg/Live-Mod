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
