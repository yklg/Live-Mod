// 面板开合态唯一真源（guangquan-shell-ui-parity v3 · A2）——纯状态 + 注入副作用，零 Electron import。
// 契约（panelController.test.ts TC-P1~P3c 固化）：
// - panelOpen/routeId 只存在于本控制器；chromeView 与 railView 一律走 toggle/close 请求入口，来源等价（TC-P1.5）。
// - 同 route 再 toggle = 收起；异 route = 换页保持展开（TC-P1.2/P1.3）。
// - 每次状态变化：applyBounds(computeShellBounds(...)) + pushRail({panelOpen, routeId}) 成对发出（TC-P2 写==读等式）。
// - resize 只重算不翻态（TC-P3b）。
import { computeShellBounds, type ShellBounds } from './shellLayout'

export interface RailState {
  panelOpen: boolean
  routeId: string | null
}

export interface PanelControllerDeps {
  winSize: () => { w: number; h: number }
  hasActiveTab: () => boolean
  /** 当前面板宽度；缺省 PANEL_W（旧调用点零变化）。 */
  panelWidth?: () => number
  applyBounds: (b: ShellBounds) => void
  pushRail: (s: RailState) => void
}

export interface PanelController {
  toggle(routeId?: string | null): void
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
        panelOpen,
        activeTabPresent: deps.hasActiveTab(),
        panelWidth: deps.panelWidth?.(),
      }),
    )
    deps.pushRail({ panelOpen, routeId })
  }

  return {
    toggle(nextRoute?: string | null) {
      if (panelOpen) {
        // 无换页意图（null/undefined）或点同图标 → 收起；异 route → 换页保持展开
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
