// 壳级通知路由判定（纯函数，shell-ui-polish v3 · TC-RT-01）
// 只有壳 UI 的 rail 业务树（完整业务树）发起的 toast 才转发到通知覆盖层；
// chrome/entry/notice 三个最小树不发业务 toast；经典 index 树保持本地 Toaster（零行为变化）。
export interface ShellViewInfo {
  name: ShellViewName
  shellUi: boolean
}

export function shouldRouteToastToNotice(view: ShellViewInfo | undefined | null): boolean {
  if (view?.shellUi !== true) return false
  return view.name === 'rail'
}
