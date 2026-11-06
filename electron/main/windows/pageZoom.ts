// 壳内页面缩放（page zoom，shell-entry-platform-selector v1 验证期用户反馈）
// 现象：官方中控台按 100% 渲染时左右内容被窗口宽度裁切（如百应直播中控台），用户需要缩小查看全貌。
// 设计：缩放按「站点 host」记忆；快捷键走壳模式自定义菜单（默认菜单的 Zoom 角色作用于壳容器而非壳内 Tab，
// 因此必须改挂到 shellUI facade），落盘 userData/shell-zoom.json。纯函数层可单测。
export const ZOOM_STEP = 0.1
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const ZOOM_DEFAULT = 1

/** 归一到 [0.5, 2]，保留两位小数（Chromium zoomFactor 精度友好） */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return ZOOM_DEFAULT
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor))
  return Math.round(clamped * 100) / 100
}

/** 步进（delta=+0.1 放大 / -0.1 缩小），到边界即停 */
export function nextZoom(current: number, delta: number): number {
  return clampZoom(clampZoom(current) + delta)
}

export function zoomPercent(factor: number): number {
  return Math.round(clampZoom(factor) * 100)
}

/** 缩放记忆键：站点 host；非 http(s)（空白页/about）返回 null 表示不记忆 */
export function zoomStoreKey(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.host
  } catch {
    return null
  }
}
