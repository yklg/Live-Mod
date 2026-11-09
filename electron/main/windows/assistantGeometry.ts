// AI 浮窗几何纯函数（与参考项目 float-window 同构）：
// 默认右下、内容区钳制、20px 吸附 / 28px 释放的滞回；不依赖 Electron，可直接单测。
export interface WindowSize {
  readonly width: number
  readonly height: number
}

export interface WindowRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AssistantSnapState {
  readonly x: boolean
  readonly y: boolean
}

export interface AssistantSnapResult {
  readonly rect: WindowRect
  readonly snap: AssistantSnapState
}

export const ASSISTANT_DEFAULT_WIDTH = 520
export const ASSISTANT_DEFAULT_HEIGHT = 640
export const ASSISTANT_MIN_WIDTH = 400
export const ASSISTANT_MIN_HEIGHT = 440
export const ASSISTANT_EDGE_MARGIN = 12
export const ASSISTANT_SNAP_ENGAGE = 20
export const ASSISTANT_SNAP_RELEASE = 28

export function defaultAssistantRect(viewport: WindowSize): WindowRect {
  const availableWidth = Math.max(ASSISTANT_MIN_WIDTH, viewport.width - 2 * ASSISTANT_EDGE_MARGIN)
  const availableHeight = Math.max(
    ASSISTANT_MIN_HEIGHT,
    viewport.height - 2 * ASSISTANT_EDGE_MARGIN,
  )
  const width = Math.min(ASSISTANT_DEFAULT_WIDTH, availableWidth)
  const height = Math.min(ASSISTANT_DEFAULT_HEIGHT, availableHeight)
  return {
    x: Math.max(ASSISTANT_EDGE_MARGIN, viewport.width - width - ASSISTANT_EDGE_MARGIN),
    y: Math.max(ASSISTANT_EDGE_MARGIN, viewport.height - height - ASSISTANT_EDGE_MARGIN),
    width,
    height,
  }
}

export function clampAssistantRect(rect: WindowRect, viewport: WindowSize): WindowRect {
  const maxWidth = Math.max(1, viewport.width - 2 * ASSISTANT_EDGE_MARGIN)
  const maxHeight = Math.max(1, viewport.height - 2 * ASSISTANT_EDGE_MARGIN)
  const width = Math.min(Math.max(rect.width, ASSISTANT_MIN_WIDTH), maxWidth)
  const height = Math.min(Math.max(rect.height, ASSISTANT_MIN_HEIGHT), maxHeight)
  return {
    width,
    height,
    x: Math.min(
      Math.max(rect.x, ASSISTANT_EDGE_MARGIN),
      viewport.width - width - ASSISTANT_EDGE_MARGIN,
    ),
    y: Math.min(
      Math.max(rect.y, ASSISTANT_EDGE_MARGIN),
      viewport.height - height - ASSISTANT_EDGE_MARGIN,
    ),
  }
}

export function moveAssistantRect(rect: WindowRect, dx: number, dy: number): WindowRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy }
}

export function resizeAssistantRect(
  rect: WindowRect,
  dx: number,
  dy: number,
  min: { width: number; height: number } = {
    width: ASSISTANT_MIN_WIDTH,
    height: ASSISTANT_MIN_HEIGHT,
  },
): WindowRect {
  return {
    ...rect,
    width: Math.max(min.width, rect.width + dx),
    height: Math.max(min.height, rect.height + dy),
  }
}

function snapAxis(
  start: number,
  maxStart: number,
  margin: number,
  engaged: boolean,
): { position: number | undefined; engaged: boolean } {
  const nearStart = start - margin
  const nearEnd = start - (maxStart - margin)
  const distance = Math.min(Math.abs(nearStart), Math.abs(nearEnd))
  const threshold = engaged ? ASSISTANT_SNAP_RELEASE : ASSISTANT_SNAP_ENGAGE
  if (distance > threshold) return { position: undefined, engaged: false }
  return Math.abs(nearStart) <= Math.abs(nearEnd)
    ? { position: margin, engaged: true }
    : { position: maxStart - margin, engaged: true }
}

export function snapAssistantRect(
  rect: WindowRect,
  viewport: WindowSize,
  state: AssistantSnapState,
): AssistantSnapResult {
  const x = snapAxis(rect.x, viewport.width - rect.width, ASSISTANT_EDGE_MARGIN, state.x)
  const y = snapAxis(rect.y, viewport.height - rect.height, ASSISTANT_EDGE_MARGIN, state.y)
  return {
    rect: {
      ...rect,
      x: x.position ?? rect.x,
      y: y.position ?? rect.y,
    },
    snap: { x: x.engaged, y: y.engaged },
  }
}
