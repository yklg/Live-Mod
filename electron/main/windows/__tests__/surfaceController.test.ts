import { describe, expect, it } from 'vitest'
import { planSurface } from '#/windows/surfaceController'

describe('surfaceController 表面转移纯函数', () => {
  it('entry：显示 entry、关闭 dock、不建 tab、不恢复 dock', () => {
    expect(planSurface('entry', { openDockRoute: 'popup', restoreDock: true })).toEqual({
      mode: 'entry',
      entryVisible: true,
      closeDock: true,
      ensureTab: null,
      restoreDock: false,
      openDockRoute: null,
    })
  })

  it('live：隐藏 entry、确保 account tab、按需恢复/打开 dock', () => {
    expect(planSurface('live')).toEqual({
      mode: 'live',
      entryVisible: false,
      closeDock: false,
      ensureTab: 'account',
      restoreDock: false,
      openDockRoute: null,
    })
    expect(planSurface('live', { restoreDock: true, openDockRoute: 'popup' })).toMatchObject({
      entryVisible: false,
      ensureTab: 'account',
      restoreDock: true,
      openDockRoute: 'popup',
    })
  })

  it('browse：隐藏 entry、确保 free tab、不恢复 dock', () => {
    expect(planSurface('browse', { restoreDock: true, openDockRoute: 'settings' })).toEqual({
      mode: 'browse',
      entryVisible: false,
      closeDock: false,
      ensureTab: 'free',
      restoreDock: false,
      openDockRoute: 'settings',
    })
  })

  it('幂等：同输入重复调用 deep-equal（无隐藏状态）', () => {
    expect(planSurface('live', { restoreDock: true })).toEqual(
      planSurface('live', { restoreDock: true }),
    )
  })
})
