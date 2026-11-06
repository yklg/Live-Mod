import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPopupModesForTest,
  clearPopupMode,
  getPopupMode,
  setPopupMode,
} from '#/windows/popupIntent'

// ===== 壳层弹窗意图（fix-shell-popup-navigation-liveend Phase 2）=====
// 契约（会话层 ↔ 壳层唯一通道）：
// - 默认 null = 浏览器语义（壳内新 Tab）——未被显式声明的弹窗绝不允许折叠当前页；
// - 'navigate' = 登录/刷新窗口期的同页折叠旧语义（粘性，登录扫码可能持续数分钟，禁止 TTL 误复位）；
// - 显式 null 复位；Tab 销毁 clear 防 wcId 复用泄漏；非法 wcId 输入安全忽略。
describe('popupIntent', () => {
  beforeEach(() => {
    _resetPopupModesForTest()
  })

  it('TC-PI1 默认浏览器语义：未声明的 wc 返回 null', () => {
    expect(getPopupMode(42)).toBeNull()
  })

  it('TC-PI2 声明 navigate 后粘性生效，显式 null 复位', () => {
    setPopupMode(42, 'navigate')
    expect(getPopupMode(42)).toBe('navigate')
    expect(getPopupMode(42)).toBe('navigate')
    setPopupMode(42, null)
    expect(getPopupMode(42)).toBeNull()
  })

  it('TC-PI3 按 wcId 隔离（不同账号 Tab 互不污染）', () => {
    setPopupMode(1, 'navigate')
    expect(getPopupMode(1)).toBe('navigate')
    expect(getPopupMode(2)).toBeNull()
  })

  it('TC-PI4 非法 wcId 输入安全忽略（不抛、不写脏状态）', () => {
    setPopupMode(0, 'navigate')
    setPopupMode(-1, 'navigate')
    setPopupMode(3.5, 'navigate')
    expect(getPopupMode(0)).toBeNull()
    expect(getPopupMode(-1)).toBeNull()
  })

  it('TC-PI5 clearPopupMode 幂等清理', () => {
    setPopupMode(7, 'navigate')
    clearPopupMode(7)
    clearPopupMode(7)
    expect(getPopupMode(7)).toBeNull()
  })

  it('TC-PI6 同 wc 重复声明幂等', () => {
    setPopupMode(9, 'navigate')
    setPopupMode(9, 'navigate')
    expect(getPopupMode(9)).toBe('navigate')
    vi.useFakeTimers()
    expect(getPopupMode(9)).toBe('navigate')
    vi.useRealTimers()
  })
})
