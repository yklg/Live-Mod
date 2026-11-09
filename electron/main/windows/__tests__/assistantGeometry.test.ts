import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_EDGE_MARGIN,
  ASSISTANT_SNAP_ENGAGE,
  ASSISTANT_SNAP_RELEASE,
  clampAssistantRect,
  defaultAssistantRect,
  moveAssistantRect,
  resizeAssistantRect,
  snapAssistantRect,
} from '#/windows/assistantGeometry'

const VIEWPORT = { width: 1440, height: 800 }
const RECT = { x: 900, y: 148, width: 520, height: 640 }

describe('assistantGeometry', () => {
  it('TC-AG1 默认右下 520×640，保留 12px 边距', () => {
    expect(defaultAssistantRect(VIEWPORT)).toEqual({
      x: VIEWPORT.width - 520 - ASSISTANT_EDGE_MARGIN,
      y: VIEWPORT.height - 640 - ASSISTANT_EDGE_MARGIN,
      width: 520,
      height: 640,
    })
  })

  it('TC-AG2 小视口回落到最小尺寸并贴边', () => {
    const rect = defaultAssistantRect({ width: 420, height: 460 })
    expect(rect.width).toBe(400)
    expect(rect.height).toBe(440)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })

  it('TC-AG3 clamp 越界/最小尺寸/负坐标', () => {
    expect(clampAssistantRect({ ...RECT, x: -100, y: -100 }, VIEWPORT)).toMatchObject({
      x: ASSISTANT_EDGE_MARGIN,
      y: ASSISTANT_EDGE_MARGIN,
    })
    expect(clampAssistantRect({ ...RECT, x: 9999, y: 9999 }, VIEWPORT)).toMatchObject({
      x: VIEWPORT.width - 520 - ASSISTANT_EDGE_MARGIN,
      y: VIEWPORT.height - 640 - ASSISTANT_EDGE_MARGIN,
    })
    expect(clampAssistantRect({ ...RECT, width: 10, height: 10 }, VIEWPORT)).toMatchObject({
      width: 400,
      height: 440,
    })
  })

  it('TC-AG4 move/resize 纯算术', () => {
    expect(moveAssistantRect(RECT, -50, 20)).toEqual({ ...RECT, x: 850, y: 168 })
    expect(resizeAssistantRect(RECT, 100, -100)).toEqual({ ...RECT, width: 620, height: 540 })
    expect(resizeAssistantRect(RECT, -999, -999)).toMatchObject({ width: 400, height: 440 })
  })

  it('TC-AG5 吸附 20px 进入 / 28px 退出（滞回）', () => {
    const free = { x: true, y: false }
    const near = snapAssistantRect(
      { ...RECT, x: ASSISTANT_EDGE_MARGIN + ASSISTANT_SNAP_ENGAGE - 1, y: 300, height: 200 },
      VIEWPORT,
      free,
    )
    expect(near.rect.x).toBe(ASSISTANT_EDGE_MARGIN)
    expect(near.snap.x).toBe(true)

    const freeAgain = snapAssistantRect(
      { ...RECT, x: ASSISTANT_EDGE_MARGIN + ASSISTANT_SNAP_ENGAGE + 1, y: 300, height: 200 },
      VIEWPORT,
      { x: false, y: false },
    )
    expect(freeAgain.snap.x).toBe(false)

    const engagedStill = snapAssistantRect(
      { ...RECT, x: ASSISTANT_EDGE_MARGIN + ASSISTANT_SNAP_RELEASE - 1, y: 300, height: 200 },
      VIEWPORT,
      { x: true, y: false },
    )
    expect(engagedStill.rect.x).toBe(ASSISTANT_EDGE_MARGIN)
    expect(engagedStill.snap.x).toBe(true)

    const released = snapAssistantRect(
      { ...RECT, x: ASSISTANT_EDGE_MARGIN + ASSISTANT_SNAP_RELEASE + 1, y: 300, height: 200 },
      VIEWPORT,
      { x: true, y: false },
    )
    expect(released.snap.x).toBe(false)
  })

  it('TC-AG6 右/下边吸附', () => {
    const result = snapAssistantRect(
      {
        x: VIEWPORT.width - 520 - ASSISTANT_EDGE_MARGIN + ASSISTANT_SNAP_ENGAGE - 1,
        y: VIEWPORT.height - 640 - ASSISTANT_EDGE_MARGIN + ASSISTANT_SNAP_ENGAGE - 1,
        width: 520,
        height: 640,
      },
      VIEWPORT,
      { x: false, y: false },
    )
    expect(result.rect.x).toBe(VIEWPORT.width - 520 - ASSISTANT_EDGE_MARGIN)
    expect(result.rect.y).toBe(VIEWPORT.height - 640 - ASSISTANT_EDGE_MARGIN)
    expect(result.snap).toEqual({ x: true, y: true })
  })
})
