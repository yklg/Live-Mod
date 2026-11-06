import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  nextZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  zoomPercent,
  zoomStoreKey,
} from '#/windows/pageZoom'

// ===== 壳内页面缩放纯函数（验证期用户反馈：百应中控台 100% 时被窗口裁切） =====
// 契约：factor ∈ [0.5,2]，步进 0.1，两位小数；记忆键 = 站点 host（非 http(s) 不记忆）。
describe('pageZoom（TC-PZ1~PZ5）', () => {
  it('TC-PZ1 clampZoom：越界夹取、非数回默认、保留两位小数', () => {
    expect(clampZoom(0.3)).toBe(ZOOM_MIN)
    expect(clampZoom(3)).toBe(ZOOM_MAX)
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(0.7999999)).toBe(0.8)
    expect(clampZoom(1.234)).toBe(1.23)
  })

  it('TC-PZ2 nextZoom：±步进、边界停住', () => {
    expect(nextZoom(1, ZOOM_STEP)).toBe(1.1)
    expect(nextZoom(1, -ZOOM_STEP)).toBe(0.9)
    expect(nextZoom(ZOOM_MAX, ZOOM_STEP)).toBe(ZOOM_MAX)
    expect(nextZoom(ZOOM_MIN, -ZOOM_STEP)).toBe(ZOOM_MIN)
    // 0.7 - 0.1 浮点精度：必须归一到 0.6 而不是 0.6000000000000001
    expect(nextZoom(0.7, -ZOOM_STEP)).toBe(0.6)
  })

  it('TC-PZ3 zoomPercent：展示百分比取整', () => {
    expect(zoomPercent(1)).toBe(100)
    expect(zoomPercent(0.8)).toBe(80)
    expect(zoomPercent(1.1)).toBe(110)
    expect(zoomPercent(0.999)).toBe(100)
  })

  it('TC-PZ4 zoomStoreKey：按 host 记忆，非 http(s) 不记忆', () => {
    expect(zoomStoreKey('https://buyin.jinritemai.com/dashboard/live/control?x=1#h')).toBe(
      'buyin.jinritemai.com',
    )
    expect(zoomStoreKey('http://127.0.0.1:8080/a')).toBe('127.0.0.1:8080')
    expect(zoomStoreKey('about:blank')).toBeNull()
    expect(zoomStoreKey('file:///a.html')).toBeNull()
    expect(zoomStoreKey('')).toBeNull()
    expect(zoomStoreKey('not a url')).toBeNull()
  })

  it('TC-PZ5 边界常量自洽（min < default < max，step 为正）', () => {
    expect(ZOOM_MIN).toBeLessThan(ZOOM_DEFAULT)
    expect(ZOOM_DEFAULT).toBeLessThan(ZOOM_MAX)
    expect(ZOOM_STEP).toBeGreaterThan(0)
  })
})
