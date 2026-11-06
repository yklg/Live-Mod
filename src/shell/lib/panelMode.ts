// 面板模式判定（纯函数，零 Electron）：C3/C4/C6 信息重构只作用于壳面板（rail 业务树），
// 经典模式（index）与 chrome/entry/notice 最小树保持原状（D6 零变化）。
export function isShellPanelView(
  view = typeof window !== 'undefined' ? window.__lmView : undefined,
) {
  if (view?.shellUi !== true) return false
  return view.name === 'rail'
}
