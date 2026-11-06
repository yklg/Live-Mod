// 外部协议/深链导航守卫（shell-entry-platform-selector v1 验证期实证补丁）
// 现象：官方中控台页面会通过 JS 触发 bytedance://dispatch_message/ 这类深链导航，
// Electron 会把它交给 macOS，系统弹「未设定用来打开 URL 的应用程序」——在壳内属越界行为
// （远程官方页不得把壳当系统浏览器用），且弹窗卡死用户视线。
// 策略：页面导航只允许 http(s)/about/data/blob；其余协议（bytedance:/mailto:/file:/…）
// 一律 preventDefault 并记日志。纯判定 `isAllowedPageNavigation` 可单测，Electron 挂钩为薄执行层。
export interface NavGuardEvent {
  preventDefault: () => void
}

/** 页面内部导航允许的协议：外链真实网页与内存页；file: 等本地协议对远程官方页一律拒绝 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'about:', 'data:', 'blob:'])

export function isAllowedPageNavigation(url: string): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol)
  } catch {
    // 畸形 URL 归为不允许（与弹窗策略 I18 保守口径一致）
    return false
  }
}

/**
 * 给页面 webContents 挂外部协议导航守卫（幂等：同一 URL 只记一次日志，避免深链风暴刷屏）。
 * will-frame-navigate 覆盖主帧+子帧（Electron 36）；will-navigate/will-redirect 兜底主帧语义。
 */
export function installExternalProtocolGuard(
  wc: Electron.WebContents,
  log: (msg: string) => void,
): void {
  const reported = new Set<string>()

  const guard = (event: NavGuardEvent, url: string) => {
    if (!url || isAllowedPageNavigation(url)) return
    event.preventDefault()
    if (reported.has(url)) return
    reported.add(url)
    log(`已拦截非 http(s) 页面导航（外部协议深链，避免系统「打开方式」弹窗）：${url.slice(0, 120)}`)
  }

  wc.on('will-frame-navigate', details => {
    guard(details, details.url)
  })
  wc.on('will-navigate', (details, url) => {
    guard(details, url)
  })
  wc.on('will-redirect', (details, url) => {
    guard(details, url)
  })
}
