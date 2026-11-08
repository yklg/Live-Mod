import { Result } from '@praha/byethrow'
import type { ElementHandle } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

// helper.ts 只从 '#/utils' 取 sleep / abortableSleep，但 '#/utils' 索引会连带
// ipc/screenshot（依赖 electron），单测环境禁止——这里只保留纯计时函数桩。
vi.mock('#/utils', async () => {
  const { Result: B } = await import('@praha/byethrow')
  return {
    sleep: () => Promise.resolve(),
    abortableSleep: () => Promise.resolve(B.succeed()),
  }
})

import { ElementContentMismatchedError, ElementDisabledError } from '#/errors/PlatformError'
import { toggleButton } from '../helper'

// ===== 契约：toggleButton 是「确保按钮处于目标状态」，不是「无脑翻转一次」 =====
// 背景：自动讲解的「商品正在讲解」场景（按钮显示「取消讲解」）旧实现会先点取消、再点讲解，
// 把正在讲解的商品无停顿地取消又重启；运营侧看到来回切换，平台按钮态未稳定时还可能丢点击。
// 期望：初始已在目标态 → 直接成功、**零点击**；源态 → 点击并等状态变化（最多 5 次）。

interface FakeButtonOptions {
  disabled?: boolean
}

/** 可编程按钮桩：初始文案 + 每次点击后的文案序列（用尽后保持当前文案） */
function makeButton(
  initialText: string,
  textsAfterClick: string[] = [],
  opts: FakeButtonOptions = {},
) {
  let text = initialText
  const queue = [...textsAfterClick]
  let clicks = 0
  return {
    get clicks() {
      return clicks
    },
    get text() {
      return text
    },
    textContent: () => Promise.resolve(text),
    isDisabled: () => Promise.resolve(opts.disabled ?? false),
    evaluate: () => Promise.resolve('<button>fake</button>'),
    dispatchEvent: (_type: string) => {
      clicks += 1
      if (queue.length > 0) text = queue.shift() as string
      return Promise.resolve()
    },
  }
}

function asHandle(button: ReturnType<typeof makeButton>) {
  return button as unknown as ElementHandle<SVGElement | HTMLElement>
}

describe('toggleButton（自动讲解按钮状态收敛）', () => {
  it('TC-TB1 [已在目标态] 商品正在讲解（按钮=取消讲解）→ 成功且不点击，并触发 onAlreadyAtTarget', async () => {
    const button = makeButton('取消讲解')
    const onAlreadyAtTarget = vi.fn()

    const result = await toggleButton(asHandle(button), '讲解', '取消讲解', undefined, {
      onAlreadyAtTarget,
    })

    expect(Result.isSuccess(result)).toBe(true)
    expect(button.clicks).toBe(0)
    expect(onAlreadyAtTarget).toHaveBeenCalledTimes(1)
  })

  it('TC-TB2 [源态] 按钮=讲解 → 点击一次变为取消讲解后成功；已点击路径不触发 onAlreadyAtTarget', async () => {
    const button = makeButton('讲解', ['取消讲解'])
    const onAlreadyAtTarget = vi.fn()

    const result = await toggleButton(asHandle(button), '讲解', '取消讲解', undefined, {
      onAlreadyAtTarget,
    })

    expect(Result.isSuccess(result)).toBe(true)
    expect(button.clicks).toBe(1)
    expect(button.text).toBe('取消讲解')
    expect(onAlreadyAtTarget).not.toHaveBeenCalled()
  })

  it('TC-TB3 [状态延迟] 第一次点击后文案未稳定，仍为讲解 → 继续点第二次直至成功', async () => {
    const button = makeButton('讲解', ['讲解', '取消讲解'])

    const result = await toggleButton(asHandle(button), '讲解', '取消讲解')

    expect(Result.isSuccess(result)).toBe(true)
    expect(button.clicks).toBe(2)
    expect(button.text).toBe('取消讲解')
  })

  it('TC-TB4 [文案漂移] 按钮文案既不是源态也不是目标态 → ElementContentMismatchedError（不点击）', async () => {
    const button = makeButton('更多')

    const result = await toggleButton(asHandle(button), '讲解', '取消讲解')

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error).toBeInstanceOf(ElementContentMismatchedError)
    }
    expect(button.clicks).toBe(0)
  })

  it('TC-TB5 [禁用态] 按钮禁用 → ElementDisabledError（点击前拦截）', async () => {
    const button = makeButton('讲解', ['取消讲解'], { disabled: true })

    const result = await toggleButton(asHandle(button), '讲解', '取消讲解')

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error).toBeInstanceOf(ElementDisabledError)
    }
    expect(button.clicks).toBe(0)
  })

  it('TC-TB6 [点击无效] 点击后状态始终不变 → 达到尝试上限后 MaxTryCountExceededError', async () => {
    // 6 次点击（tryCount 0..5），第 7 次递归在 tryCount=6 时超过上限
    const button = makeButton(
      '讲解',
      Array.from({ length: 10 }, () => '讲解'),
    )

    const result = await toggleButton(asHandle(button), '讲解', '取消讲解')

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.name).toBe('MaxTryCountExceededError')
    }
    expect(button.clicks).toBe(6)
  })
})
