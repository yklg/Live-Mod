// 中控台默认缩放策略（平台层，零 Electron import）。
//
// 为什么放在平台层：默认缩放是「站点知识」，与 ownedOrigins / CONTROL_PAGE 同一边界（A5）。
// shell 层只消费 defaultZoomForHost，不内建任何平台域名。
//
// 现象：官方中控台按 100% 渲染时，1280 窗口下左右内容被裁切（用户看不到完整后台）。
// 策略：中控站点默认 80%（有效宽度约 1600px）；用户手动 Cmd +/- 的值仍按 host 优先持久化。
// 未收录的站点回落到通用默认 100%。

import { clampZoom, ZOOM_DEFAULT } from '#/windows/pageZoom'
import { CONTROL_PAGE as BUYIN_CONTROL_PAGE } from './buyin/constant'
import { CONTROL_PAGE as DOUYIN_CONTROL_PAGE } from './douyin/constant'
import { CONTROL_PAGE as EOS_CONTROL_PAGE } from './douyin-eos/constant'

export const CONSOLE_DEFAULT_ZOOM = 0.8

const DEFAULT_ZOOM_BY_HOST: ReadonlyMap<string, number> = new Map([
  [DOUYIN_CONTROL_PAGE.host, CONSOLE_DEFAULT_ZOOM],
  [BUYIN_CONTROL_PAGE.host, CONSOLE_DEFAULT_ZOOM],
  [EOS_CONTROL_PAGE.host, CONSOLE_DEFAULT_ZOOM],
])

/** 站点默认缩放：host 大小写不敏感；未收录 → 通用默认 1。 */
export function defaultZoomForHost(host: string): number {
  return clampZoom(DEFAULT_ZOOM_BY_HOST.get(host.toLowerCase()) ?? ZOOM_DEFAULT)
}
