import { describe, expect, it } from 'vitest'
import { createPanelController } from '#/windows/panelController'
import { type computeShellBounds, PANEL_W, RAIL_W } from '#/windows/shellLayout'

// ===== 面板开合态唯一真源（guangquan-shell-ui-parity v3 · A2）=====
// 契约：panelOpen 只存在于主进程本控制器；chrome/rail 一律发请求（toggle/close），
// 本层翻转状态 → computeShellBounds 重算 → applyBounds + pushRail 回推。
// 渲染层（railView）不持开合态——TC-P2 的配对等式（推送态==bounds 宽度档）是防漂移主防线。
// createPanelController(deps)：deps = { winSize():{w,h}, hasActiveTab():boolean, applyBounds(b), pushRail(s) }
// 方法：toggle(routeId?)（同 route 再点=收起；异 route=换页保持展开）/ close() / resize() /
//       isOpen() / route()

function setup(opts?: { winW?: number; winH?: number; hasActiveTab?: boolean }) {
  const size = { w: opts?.winW ?? 1440, h: opts?.winH ?? 800 }
  const applied: Array<ReturnType<typeof computeShellBounds>> = []
  const pushed: Array<{ panelOpen: boolean; routeId: string | null }> = []
  const ctrl = createPanelController({
    winSize: () => ({ ...size }),
    hasActiveTab: () => opts?.hasActiveTab ?? true,
    applyBounds: b => applied.push(b),
    pushRail: s => pushed.push(s),
  })
  return { size, ctrl, applied, pushed }
}

describe('panelController 开合决策表（TC-P1）', () => {
  it('TC-P1.1 [chrome 发起] toggle(popup) → 展开，推送与 bounds 同步', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('popup')
    expect(f.pushed.at(-1)).toEqual({ panelOpen: true, routeId: 'popup' })
    expect(f.applied.at(-1)?.rail.width).toBe(PANEL_W)
  })

  it('TC-P1.2 [rail 同图标再点] 展开态 toggle(同 route) → 收起', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    f.ctrl.toggle('popup')
    expect(f.ctrl.isOpen()).toBe(false)
    expect(f.pushed.at(-1)).toEqual({ panelOpen: false, routeId: null })
    expect(f.applied.at(-1)?.rail.width).toBe(RAIL_W)
  })

  it('TC-P1.3 [换页不收起] 展开态 toggle(异 route) → 保持展开、route 切换', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    f.ctrl.toggle('msg')
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.ctrl.route()).toBe('msg')
    expect(f.pushed.at(-1)).toEqual({ panelOpen: true, routeId: 'msg' })
  })

  it('TC-P1.4 [ESC/×] close() 幂等：双调仍为收起', () => {
    const f = setup()
    f.ctrl.toggle('popup')
    f.ctrl.close()
    f.ctrl.close()
    expect(f.ctrl.isOpen()).toBe(false)
    expect(f.ctrl.route()).toBeNull()
  })

  it('TC-P1.5 [来源等价] chrome 与 rail 的 toggle 走同一入口，效果与来源无关', () => {
    const a = setup()
    const b = setup()
    a.ctrl.toggle('ai')
    b.ctrl.toggle('ai')
    expect(a.pushed).toEqual(b.pushed)
    expect(a.applied).toEqual(b.applied)
  })
})

describe('panelController 配对契约与降级（TC-P2~P3）', () => {
  it('TC-P2 [配对等式·storage TC-02 同构] 任意操作后：推送 panelOpen == rail bounds 宽度档（写==读）', () => {
    const f = setup()
    const ops = [
      () => f.ctrl.toggle('popup'),
      () => f.ctrl.toggle('msg'),
      () => f.ctrl.toggle('msg'),
      () => f.ctrl.close(),
      () => f.ctrl.toggle('set'),
    ]
    for (const op of ops) {
      op()
      const lastPush = f.pushed.at(-1)
      const lastBounds = f.applied.at(-1)
      expect(lastPush?.panelOpen, `op 后宽度=${lastBounds?.rail.width}`).toBe(
        lastBounds && lastBounds.rail.width > RAIL_W,
      )
    }
  })

  it('TC-P3 [窄窗降级无漂移] winW=640（<DEGRADE_W 656）连续 toggle 两次：全宽↔收起状态一致', () => {
    const f = setup({ winW: 640 })
    f.ctrl.toggle('popup')
    expect(f.applied.at(-1)?.rail).toMatchObject({ x: 0, width: 640 }) // 全宽覆盖档
    f.ctrl.toggle('popup')
    expect(f.applied.at(-1)?.rail.width).toBe(RAIL_W)
    f.ctrl.toggle('popup')
    // 窄窗（<DEGRADE_W）重开仍走降级全宽档，不出现 600 溢出
    expect(f.applied.at(-1)?.rail.width).toBe(640)
    expect(f.pushed.at(-1)?.panelOpen).toBe(true)
  })

  it('TC-P3b [resize 重算] 展开中窗口变窄到 <DEGRADE_W → applyBounds 收到降级档，推送态不变', () => {
    const f = setup({ winW: 1440 })
    f.ctrl.toggle('popup')
    expect(f.applied.at(-1)?.rail.width).toBe(PANEL_W)
    f.size.w = 640
    f.ctrl.resize()
    expect(f.applied.at(-1)?.rail.width).toBe(640)
    expect(f.ctrl.isOpen()).toBe(true)
    expect(f.pushed.at(-1)?.panelOpen).toBe(true)
  })

  it('TC-P3c [无 active Tab] hasActiveTab=false 时 bounds.page=null，面板逻辑不受影响', () => {
    const f = setup({ hasActiveTab: false })
    f.ctrl.toggle('popup')
    expect(f.applied.at(-1)?.page).toBeNull()
    expect(f.applied.at(-1)?.rail.width).toBe(PANEL_W)
  })
})
