// 壳层弹窗意图（fix-shell-popup-navigation-liveend Phase 2 · 会话层 ↔ 壳层唯一契约）
//
// 背景：官方页 window.open 的语义是「打开新上下文」。壳 UI 在单窗口内用 Tab 表达该语义，
// 因此默认策略 = 浏览器语义（壳内新 Tab）。但登录/进中控台等自动化链路依赖「弹窗即同页导航」
// 的旧语义（防反爬的控件点击打开），必须由会话层显式声明——禁止壳层按 URL 猜测。
//
// 契约：
// - setPopupMode(wcId, 'navigate')：该 pageView 后续所有「同域/可信域」弹窗折叠为当前页导航（旧语义）；
// - setPopupMode(wcId, null)：恢复浏览器语义（壳内新 Tab）——登录完成后必须复位；
// - 粘性模式，仅在显式复位或 webContents 销毁时失效（登录扫码可能持续数分钟，禁止 TTL 误复位）；
// - getPopupMode 只读查询；clearPopupMode 在 Tab 销毁时清理，防 wcId 复用泄漏。

export type ShellPopupMode = 'navigate'

interface Entry {
  mode: ShellPopupMode
}

const modes = new Map<number, Entry>()

/** 显式声明弹窗语义（'navigate'=折叠当前页；null=浏览器语义）。幂等。 */
export function setPopupMode(webContentsId: number, mode: ShellPopupMode | null): void {
  if (!Number.isInteger(webContentsId) || webContentsId <= 0) return
  if (mode === null) {
    modes.delete(webContentsId)
    return
  }
  modes.set(webContentsId, { mode })
}

/** 查询当前弹窗语义；null = 浏览器语义（默认）。 */
export function getPopupMode(webContentsId: number): ShellPopupMode | null {
  return modes.get(webContentsId)?.mode ?? null
}

/** Tab/视图销毁时清理（wcId 复用防泄漏）；幂等。 */
export function clearPopupMode(webContentsId: number): void {
  modes.delete(webContentsId)
}

/** 仅测试用：清空全部状态。 */
export function _resetPopupModesForTest(): void {
  modes.clear()
}
