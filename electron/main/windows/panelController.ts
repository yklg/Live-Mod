// dock 开合态唯一真源（第二期）：纯状态 + 注入副作用，零 Electron import。
// 与第一期差异：computeShellBounds 需要 mode/dockWidth；page bounds 在 dock 模式让出宽度，
// 在 overlay 模式保持不变。宽度本身的拖拽写入仍由 shellUI 持有并持久化。
//
// 壳 v3 · Wave 3：菜单态也收口到这里（计划 §5.2）——
// RailState 由 createPanelController **唯一持有**，渲染层只跟随推送渲染。
// 面板与菜单**互斥**：开菜单时面板让位（记下 route 以便恢复），选中项则菜单关、面板开。
import { computeShellBounds, type ShellBounds, type ShellMode } from './shellLayout'

export interface RailState {
  panelOpen: boolean
  routeId: string | null
  /** 顶栏悬浮菜单是否打开（壳 v3 · Wave 3） */
  menuOpen: boolean
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
  /** 顶栏悬浮菜单（壳 v3 · Wave 3） */
  toggleMenu(): void
  openMenu(): void
  closeMenu(): void
  selectMenu(routeId: string): void
  isMenuOpen(): boolean
}

export function createPanelController(deps: PanelControllerDeps): PanelController {
  let panelOpen = false
  let routeId: string | null = null
  let menuOpen = false
  /** 开菜单前面板所在的 route：关菜单时恢复（面板让位而不是被丢弃） */
  let restoreRoute: string | null = null
  /** 开菜单前面板是否处于打开态：关菜单时据此决定恢复还是保持收起 */
  let restorePanelOpen = false

  const apply = () => {
    const { w, h } = deps.winSize()
    deps.applyBounds(
      computeShellBounds({
        winW: w,
        winH: h,
        mode: deps.mode?.() ?? 'live',
        dockOpen: panelOpen,
        dockWidth: deps.dockWidth?.(),
        menuOpen,
        activeTabPresent: deps.hasActiveTab(),
      }),
    )
    deps.pushRail({ panelOpen, routeId, menuOpen })
  }

  return {
    toggle(nextRoute?: string | null) {
      if (menuOpen) {
        // 菜单开着时，面板入口相当于"取消菜单"
        this.closeMenu()
        return
      }
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
      menuOpen = false
      restoreRoute = null
      restorePanelOpen = false
      panelOpen = true
      routeId = nextRoute
      apply()
    },
    close() {
      menuOpen = false
      restoreRoute = null
      restorePanelOpen = false
      panelOpen = false
      routeId = null
      apply()
    },
    resize() {
      apply()
    },
    isOpen: () => panelOpen,
    route: () => routeId,

    toggleMenu() {
      if (menuOpen) this.closeMenu()
      else this.openMenu()
    },
    openMenu() {
      if (menuOpen) return
      // 面板让位：记下当前 route 与开合态，菜单关闭后可原样恢复
      restoreRoute = routeId
      restorePanelOpen = panelOpen
      panelOpen = false
      routeId = null
      menuOpen = true
      apply()
    },
    closeMenu() {
      if (!menuOpen) return
      menuOpen = false
      // 恢复打开菜单前的面板态（本来没有面板就保持收起）
      panelOpen = restorePanelOpen
      routeId = restoreRoute
      restoreRoute = null
      restorePanelOpen = false
      apply()
    },
    selectMenu(nextRoute: string) {
      // 关闭信号之一：选中项 → 菜单关 + 面板开（选中项）
      menuOpen = false
      restoreRoute = null
      restorePanelOpen = false
      panelOpen = true
      routeId = nextRoute
      apply()
    },
    isMenuOpen: () => menuOpen,
  }
}
