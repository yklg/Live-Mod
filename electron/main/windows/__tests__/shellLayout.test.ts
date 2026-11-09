import { describe, expect, it } from 'vitest'
import {
  CHROME_H,
  clampPanelWidth,
  computeEntryBounds,
  computeShellBounds,
  DEGRADE_W,
  degradeThreshold,
  draggedPanelWidth,
  MIN_WIN_WIDTH,
  PAGE_MIN,
  PANEL_MAX,
  PANEL_MIN,
  PANEL_VISIBLE_MIN,
  PANEL_W,
  RAIL_W,
} from '#/windows/shellLayout'

// ===== 壳布局纯函数（guangquan-shell-ui-parity v3 · A3）=====
// 契约：computeShellBounds({winW,winH,panelOpen,activeTabPresent}) → {chrome,rail,page|null}
// 唯一真源：所有 view bounds 由本函数产出，shellUI 只做 setBounds 执行（禁止在别处算几何）。
// 断言格式：bounds = {x,y,width,height}（Electron setBounds 同形）。

type Input = {
  winW: number
  winH: number
  panelOpen: boolean
  activeTabPresent: boolean
  panelWidth?: number
}
const base = (o: Partial<Input>): Input => ({
  winW: 1440,
  winH: 800,
  panelOpen: false,
  activeTabPresent: true,
  ...o,
})

describe('shellLayout 决策表（TC-L1~L9）', () => {
  // 表驱动：winW × panelOpen 八组合（activeTabPresent=true，winH=800）
  const table: Array<[string, Input, { rail: object; page: object | null }]> = [
    [
      'L1 宽窗收起',
      base({}),
      {
        rail: { x: 1440 - RAIL_W, y: CHROME_H, width: RAIL_W, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: 1440 - RAIL_W, height: 800 - CHROME_H },
      },
    ],
    [
      'L2 宽窗展开（overlay 语义：page 不因面板而变）',
      base({ panelOpen: true }),
      {
        rail: { x: 1440 - PANEL_W, y: CHROME_H, width: PANEL_W, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: 1440 - RAIL_W, height: 800 - CHROME_H },
      },
    ],
    [
      'L3 656 展开仍 overlay（600 钳到 PANEL_MIN）',
      base({ winW: DEGRADE_W, panelOpen: true }),
      {
        rail: { x: DEGRADE_W - PANEL_MIN, y: CHROME_H, width: PANEL_MIN, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: DEGRADE_W - RAIL_W, height: 800 - CHROME_H },
      },
    ],
    [
      'L4 655 展开为 overlay（PANEL_MIN 钳制）',
      base({ winW: DEGRADE_W - 1, panelOpen: true }),
      {
        rail: {
          x: DEGRADE_W - 1 - PANEL_MIN,
          y: CHROME_H,
          width: PANEL_MIN,
          height: 800 - CHROME_H,
        },
        page: { x: 0, y: CHROME_H, width: DEGRADE_W - 1 - RAIL_W, height: 800 - CHROME_H },
      },
    ],
    [
      'L4b 475 展开降级全宽（< PANEL_MIN+RAIL_W）',
      base({ winW: PANEL_MIN + RAIL_W - 1, panelOpen: true }),
      {
        rail: { x: 0, y: CHROME_H, width: PANEL_MIN + RAIL_W - 1, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: PANEL_MIN - 1, height: 800 - CHROME_H },
      },
    ],
    [
      'L5 655 收起正常',
      base({ winW: DEGRADE_W - 1 }),
      {
        rail: { x: DEGRADE_W - 1 - RAIL_W, y: CHROME_H, width: RAIL_W, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: DEGRADE_W - 1 - RAIL_W, height: 800 - CHROME_H },
      },
    ],
    [
      'L6 恰 696 页宽=640 下限',
      base({ winW: 696 }),
      {
        rail: { x: 696 - RAIL_W, y: CHROME_H, width: RAIL_W, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: PAGE_MIN, height: 800 - CHROME_H },
      },
    ],
    [
      'L7 696 展开为 overlay（PANEL_MIN 钳制）',
      base({ winW: 696, panelOpen: true }),
      {
        rail: { x: 696 - PANEL_MIN, y: CHROME_H, width: PANEL_MIN, height: 800 - CHROME_H },
        page: { x: 0, y: CHROME_H, width: PAGE_MIN, height: 800 - CHROME_H },
      },
    ],
    [
      'L8 无 active Tab：page=null，rail 照常',
      base({ activeTabPresent: false }),
      {
        rail: { x: 1440 - RAIL_W, y: CHROME_H, width: RAIL_W, height: 800 - CHROME_H },
        page: null,
      },
    ],
  ]

  for (const [name, input, expected] of table) {
    it(`TC-${name}`, () => {
      const r = computeShellBounds(input)
      expect(r.chrome).toEqual({ x: 0, y: 0, width: input.winW, height: CHROME_H })
      expect(r.rail).toEqual(expected.rail)
      if (expected.page === null) expect(r.page).toBeNull()
      else expect(r.page).toEqual(expected.page)
    })
  }

  it('TC-L9 [边界值] 实际降级阈值跟随面板宽度（默认 600 → 656；最小 420 → 476）', () => {
    expect(PANEL_W).toBe(600)
    expect(PANEL_MIN).toBe(420)
    expect(DEGRADE_W).toBe(PANEL_W + RAIL_W)
    expect(degradeThreshold(PANEL_MIN)).toBe(PANEL_MIN + RAIL_W)
    expect(computeShellBounds(base({ winW: PANEL_MIN + RAIL_W, panelOpen: true })).rail.width).toBe(
      PANEL_MIN,
    )
    expect(
      computeShellBounds(base({ winW: PANEL_MIN + RAIL_W - 1, panelOpen: true })).rail.width,
    ).toBe(PANEL_MIN + RAIL_W - 1)
  })

  it('TC-L14b [死分支文档化] 实际最小窗 1024 > DEGRADE_W；1024 下默认宽度钳到 648', () => {
    // 与 electron/main/app.ts minWidth 对齐；常量漂移时该断言提醒同步注释/验收口径
    expect(1024).toBeGreaterThan(DEGRADE_W)
    expect(computeShellBounds(base({ winW: 1024, panelOpen: true })).rail.width).toBe(
      clampPanelWidth(PANEL_W, 1024),
    )
  })
})

describe('可变面板宽度（TC-L17~L20）', () => {
  it('TC-L17 [clampPanelWidth] 1024/1280/1440 三档与非法输入', () => {
    expect(clampPanelWidth(600, 1024)).toBe(600)
    expect(clampPanelWidth(600, 1280)).toBe(600)
    expect(clampPanelWidth(600, 1440)).toBe(600)
    expect(clampPanelWidth(900, 1024)).toBe(648)
    expect(clampPanelWidth(900, 1280)).toBe(880)
    expect(clampPanelWidth(420, 1024)).toBe(420)
    expect(clampPanelWidth(-1, 1280)).toBe(PANEL_MIN)
    expect(clampPanelWidth(Number.NaN, 1280)).toBe(PANEL_W)
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, 1280)).toBe(PANEL_W)
  })

  it('TC-L18 [可见页宽下限] 1024/1280/1440 下可见页宽 >= PANEL_VISIBLE_MIN', () => {
    for (const [winW, panelW] of [
      [1024, 648],
      [1280, 880],
      [1440, 880],
    ] as const) {
      const r = computeShellBounds(base({ winW, panelOpen: true, panelWidth: panelW }))
      expect(r.rail.width).toBe(panelW)
      const visible = (r.page?.width ?? 0) - panelW
      expect(visible).toBeGreaterThanOrEqual(PANEL_VISIBLE_MIN)
    }
  })

  it('TC-L19 [宽度跟随窗口钳制] 880 只在 winW>=1256 成立，1255 按可见页宽钳到 879', () => {
    expect(clampPanelWidth(PANEL_MAX, 1256)).toBe(PANEL_MAX)
    expect(clampPanelWidth(PANEL_MAX, 1255)).toBe(879)
    expect(
      computeShellBounds(base({ winW: 1256, panelOpen: true, panelWidth: PANEL_MAX })).rail.width,
    ).toBe(PANEL_MAX)
    expect(
      computeShellBounds(base({ winW: 1255, panelOpen: true, panelWidth: PANEL_MAX })).rail.width,
    ).toBe(879)
  })

  it('TC-L20 [overlay 语义] panelWidth 变化不改 page bounds', () => {
    const closed = computeShellBounds(base({ winW: 1280 }))
    const open = computeShellBounds(base({ winW: 1280, panelOpen: true, panelWidth: PANEL_MAX }))
    expect(open.page).toEqual(closed.page)
  })

  it('TC-L21 [拖拽算术] 向左拖变宽、向右拖变窄、零位移不变', () => {
    expect(draggedPanelWidth(600, 1000, 900)).toBe(700)
    expect(draggedPanelWidth(600, 1000, 1100)).toBe(500)
    expect(draggedPanelWidth(600, 1000, 1000)).toBe(600)
    expect(clampPanelWidth(draggedPanelWidth(600, 1000, 0), 1024)).toBe(648)
  })
})

describe('shellLayout 不变量（TC-L10~L13）', () => {
  it('TC-L10 [INV] chrome 恒 {0,0,winW,120}，任何输入下', () => {
    for (const w of [696, 855, 856, 1440, 2560]) {
      for (const open of [true, false]) {
        for (const tab of [true, false]) {
          expect(
            computeShellBounds(base({ winW: w, panelOpen: open, activeTabPresent: tab })).chrome,
          ).toEqual({ x: 0, y: 0, width: w, height: CHROME_H })
        }
      }
    }
  })

  it('TC-L11 [INV] 收起态 page 与 rail 恰邻接不相交；展开态 page 与收起态逐键相同（overlay）', () => {
    const closed = computeShellBounds(base({}))
    expect(closed.page?.width).toBe(closed.rail.x) // 恰邻接：page 右缘 == rail 左缘
    const open = computeShellBounds(base({ panelOpen: true }))
    expect(open.page).toEqual(closed.page) // overlay 语义：面板不改 page bounds
  })

  it('TC-L12 [INV] winW ≥ MIN_WIN_WIDTH(696) 时 page.width ≥ PAGE_MIN(640)（历史阈值，未接入运行时）', () => {
    expect(MIN_WIN_WIDTH).toBe(PAGE_MIN + RAIL_W)
    for (const w of [696, 700, 856, 1000, 1440]) {
      for (const open of [true, false]) {
        expect(
          computeShellBounds(base({ winW: w, panelOpen: open })).page?.width,
        ).toBeGreaterThanOrEqual(PAGE_MIN)
      }
    }
  })

  it('TC-L13 [纯性] 同输入两次调用 deep-equal（无内部状态）', () => {
    const a = computeShellBounds(base({ winW: 900, panelOpen: true }))
    const b = computeShellBounds(base({ winW: 900, panelOpen: true }))
    expect(a).toEqual(b)
  })
})

describe('壳入口视图几何（TC-L14~L16 · shell-entry-platform-selector v1）', () => {
  it('TC-L14 [入口覆盖页面区] 与页面区同形：chrome 下、rail 图标条左，不依赖活跃 Tab', () => {
    const entry = computeEntryBounds({ winW: 1280, winH: 800 })
    expect(entry).toEqual({ x: 0, y: CHROME_H, width: 1280 - RAIL_W, height: 800 - CHROME_H })
    // 与有活跃 Tab 的 page bounds 逐键一致（入口出现时页面可能在底层/也可能尚未建）
    const page = computeShellBounds(base({ winW: 1280, winH: 800 })).page
    expect(entry).toEqual(page)
  })

  it('TC-L15 [面板 overlay 不影响入口几何] 入口几何与 panelOpen 无关（同 winW 恒等）', () => {
    const closed = computeEntryBounds({ winW: 1000, winH: 700 })
    // computeShellBounds 的 page 在面板展开时保持逐键相同（overlay 语义）→ 入口同源
    expect(computeEntryBounds({ winW: 1000, winH: 700 })).toEqual(closed)
    expect(computeShellBounds(base({ winW: 1000, winH: 700, panelOpen: true })).page).toEqual(
      closed,
    )
  })

  it('TC-L16 [纯性/边界] 同输入 deep-equal；winW < DEGRADE_W 时入口仍扣 rail 图标条宽', () => {
    expect(computeEntryBounds({ winW: 900, winH: 600 })).toEqual(
      computeEntryBounds({ winW: 900, winH: 600 }),
    )
    const narrow = computeEntryBounds({ winW: 700, winH: 600 })
    expect(narrow.width).toBe(700 - RAIL_W)
    expect(narrow.width).toBeGreaterThanOrEqual(PAGE_MIN - RAIL_W) // 700 窗口下入口仍为正宽
  })
})
