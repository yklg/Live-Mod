import { describe, expect, it } from 'vitest'
import { shouldWarnLeaveControlPage } from '#/windows/leaveGuard'

// ===== 导航离开护栏（guangquan-shell-ui-parity v3 · P2-6）=====
// 契约：仅「账号 Tab ∧ 该账号任务运行中 ∧ 导航离开 controlHost」三条件同时成立才告警；
// 任何无法判定输入（畸形 URL / 非 http(s)）归不告警（保守档，与 popupPolicy I18 同向但语义相反：
// 护栏是提示性副作用，误报比漏报代价高）。不阻断导航（liveStatusWatcher 已有缺席防抖容错）。

const CONTROL = 'buyin.jinritemai.com'

describe('leaveGuard 决策表（TC-N1）', () => {
  it('TC-N1.1 [触发] account ∧ running ∧ 离开 controlHost → 告警', () => {
    expect(
      shouldWarnLeaveControlPage({
        kind: 'account',
        taskRunning: true,
        toUrl: 'https://example.com/other',
        controlHost: CONTROL,
      }),
    ).toBe(true)
  })

  it('TC-N1.2 [等价类·free] 自由 Tab 永不告警', () => {
    expect(
      shouldWarnLeaveControlPage({
        kind: 'free',
        taskRunning: true,
        toUrl: 'https://example.com',
        controlHost: CONTROL,
      }),
    ).toBe(false)
  })

  it('TC-N1.3 [等价类·未运行] 任务未运行不告警', () => {
    expect(
      shouldWarnLeaveControlPage({
        kind: 'account',
        taskRunning: false,
        toUrl: 'https://example.com',
        controlHost: CONTROL,
      }),
    ).toBe(false)
  })

  it('TC-N1.4 [等价类·域内导航] 同 controlHost 任意 path/query 不告警', () => {
    for (const url of [
      `https://${CONTROL}/dashboard/live/plan`,
      `https://${CONTROL}/x?a=1#frag`,
      `https://${CONTROL}:443/y`,
    ]) {
      expect(
        shouldWarnLeaveControlPage({
          kind: 'account',
          taskRunning: true,
          toUrl: url,
          controlHost: CONTROL,
        }),
        url,
      ).toBe(false)
    }
  })

  it('TC-N1.5 [边界·大小写/尾点] host 归一后同域不告警', () => {
    expect(
      shouldWarnLeaveControlPage({
        kind: 'account',
        taskRunning: true,
        toUrl: 'https://BUYIN.JINRITEMAI.COM/a',
        controlHost: CONTROL,
      }),
    ).toBe(false)
  })

  it('TC-N1.6 [畸形输入保守档] about:blank / 非 http(s) / 空串 → 不告警不抛', () => {
    for (const url of ['about:blank#lm-nonce-a1-u1', 'file:///x', 'javascript:alert(1)', '']) {
      expect(
        shouldWarnLeaveControlPage({
          kind: 'account',
          taskRunning: true,
          toUrl: url,
          controlHost: CONTROL,
        }),
        url,
      ).toBe(false)
    }
  })
})
