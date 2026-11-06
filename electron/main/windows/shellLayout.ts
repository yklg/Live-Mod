// 壳布局几何唯一真源（guangquan-shell-ui-parity v3 · A3）——纯函数，零 Electron import。
// 范式沿用 popupPolicy/foldNavigate/pageFactory「纯决策函数 + 薄执行壳」：
// shellUI/panelController 只消费本函数产出的 bounds 做 setBounds，禁止在别处算几何。
// 测试锚：shellLayout.test.ts TC-L1~L13（决策表/边界/不变量/纯性）。

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellBounds {
  chrome: Bounds
  rail: Bounds
  page: Bounds | null
}

export const CHROME_H = 120 // 40 Tab 行 + 44 工具行 + 36 快捷条
export const RAIL_W = 56 // 收起态图标条宽
// 面板宽度 = 纯产品参数（遮挡面积），**布局不依赖该值**：面板树用容器查询 @xl/panel 适配，
// 因此 600/800 均可；旧 800 曾用于补偿 CSS md(768) 断点（视口=面板宽度），容器化后不再需要。
export const PANEL_W = 600
export const PAGE_MIN = 640 // A0 门禁实证官方页可用宽度
// 降级阈值：winW 低于 panel+rail 时面板全宽覆盖。注意：当前主窗口 minWidth=1024（app.ts），
// 656/原 856 均低于 1024 → 该分支在常规窗口下不可达（保留以覆盖未来最小宽调整；测试锁定关系）。
export const DEGRADE_W = PANEL_W + RAIL_W
// 历史阈值（未接入运行时；实际窗口下限由 app.ts minWidth=1024 控制），仅保留纯函数性质测试。
export const MIN_WIN_WIDTH = PAGE_MIN + RAIL_W

export interface ShellLayoutInput {
  winW: number
  winH: number
  panelOpen: boolean
  activeTabPresent: boolean
}

/**
 * 计算三 view 的完整 bounds（chrome 顶栏恒全宽；rail 右缘常驻；page 铺满 chrome 下方剩余区）。
 * overlay 语义：面板展开只改 rail bounds，page bounds 与收起态逐键相同（TC-L11）。
 * 降级规则：winW < DEGRADE_W 且展开时 rail 全宽覆盖（x=0, width=winW）。
 */
export function computeShellBounds({
  winW,
  winH,
  panelOpen,
  activeTabPresent,
}: ShellLayoutInput): ShellBounds {
  const chrome: Bounds = { x: 0, y: 0, width: winW, height: CHROME_H }

  const bodyY = CHROME_H
  const bodyH = winH - CHROME_H

  let rail: Bounds
  if (!panelOpen) {
    rail = { x: winW - RAIL_W, y: bodyY, width: RAIL_W, height: bodyH }
  } else if (winW >= DEGRADE_W) {
    rail = { x: winW - PANEL_W, y: bodyY, width: PANEL_W, height: bodyH }
  } else {
    rail = { x: 0, y: bodyY, width: winW, height: bodyH }
  }

  const page: Bounds | null = activeTabPresent
    ? { x: 0, y: bodyY, width: winW - RAIL_W, height: bodyH }
    : null

  return { chrome, rail, page }
}

/**
 * 壳入口选择器视图 bounds（shell-entry-platform-selector v1）：
 * 覆盖「页面区」——chrome 下、常驻 rail 图标条左侧。与 page bounds 同形但**不依赖活跃 Tab**
 * （入口出现时页面可能尚未建/已关闭）。notice 通知层为独立透明窗口（需窗口级点击穿透），
 * 不复用本视图几何——两者定位方式不同，见 windows/noticeWindow.ts。
 */
export function computeEntryBounds({ winW, winH }: { winW: number; winH: number }): Bounds {
  return { x: 0, y: CHROME_H, width: winW - RAIL_W, height: winH - CHROME_H }
}
