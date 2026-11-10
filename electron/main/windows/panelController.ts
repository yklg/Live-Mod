// dock 开合态唯一真源（第二期）：纯状态 + 注入副作用，零 Electron import。
// 与第一期差异：computeShellBounds 需要 mode/dockWidth；page bounds 在 dock 模式让出宽度，
// 在 overlay 模式保持不变。宽度本身的拖拽写入仍由 shellUI 持有并持久化。
import { computeShellBounds, type ShellBounds, type ShellMode } from './shellLayout'

export interface RailState {
  panelOpen: boolean
  routeId: string | null
}

export interface PanelControllerDeps {
  winSize: () => { w: number; h: number }
  hasActiveTab: () => boolean
  mode?: () => ShellMode
  dockWidth?: () => number
  applyBounds: (b: ShellBounds) => void
  pushRail: (s: RailState) => void
}

export interface PanelController {
  toggle(routeId?: string | null): void
  open(routeId: string | null): void
  close(): void
  resize(): void
  isOpen(): boolean
  route(): string | null
}

export function createPanelController(deps: PanelControllerDeps): PanelController {
  let panelOpen = false
  let routeId: string | null = null

  const apply = () => {
    const { w, h } = deps.winSize()
    deps.applyBounds(
      computeShellBounds({
        winW: w,
        winH: h,
        mode: deps.mode?.() ?? 'live',
        dockOpen: panelOpen,
        dockWidth: deps.dockWidth?.(),
        activeTabPresent: deps.hasActiveTab(),
      }),
    )
    deps.pushRail({ panelOpen, routeId })
  }

  return {
    toggle(nextRoute?: string | null) {
      if (panelOpen) {
        if (nextRoute == null || nextRoute === routeId) {
          panelOpen = false
          routeId = null
        } else {
          routeId = nextRoute
        }
      } else {
        panelOpen = true
        routeId = nextRoute ?? null
      }
      apply()
    },
    open(nextRoute: string | null) {
      panelOpen = true
      routeId = nextRoute
      apply()
    },
    close() {
      panelOpen = false
      routeId = null
      apply()
    },
    resize() {
      apply()
    },
    isOpen: () => panelOpen,
    route: () => routeId,
  }
}
