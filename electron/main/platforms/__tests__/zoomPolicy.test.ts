import { describe, expect, it } from 'vitest'
import { CONSOLE_DEFAULT_ZOOM, defaultZoomForHost } from '#/platforms/zoomPolicy'
import { ZOOM_DEFAULT } from '#/windows/pageZoom'

// 中控台默认缩放策略：站点知识归平台层，shell 层只消费 host → factor。
describe('zoomPolicy（中控台默认缩放）', () => {
  it('抖店/百应/团购中控默认 80%', () => {
    expect(CONSOLE_DEFAULT_ZOOM).toBe(0.8)
    expect(defaultZoomForHost('fxg.jinritemai.com')).toBe(0.8)
    expect(defaultZoomForHost('buyin.jinritemai.com')).toBe(0.8)
    expect(defaultZoomForHost('eos.douyin.com')).toBe(0.8)
  })

  it('host 大小写不敏感', () => {
    expect(defaultZoomForHost('BUYIN.JINRITEMAI.COM')).toBe(0.8)
  })

  it('未收录站点回落通用默认 1（自由浏览不受影响）', () => {
    expect(defaultZoomForHost('example.com')).toBe(ZOOM_DEFAULT)
    expect(defaultZoomForHost('compass.jinritemai.com')).toBe(ZOOM_DEFAULT)
  })
})
