// 当前壳顶栏高度（第二期）：由 shellUI 每次 applyBounds 写入；notice 等子窗口读它。
import { CHROME_H } from './shellLayout'

let current = CHROME_H

export function setChromeHeight(height: number) {
  if (Number.isFinite(height) && height > 0) current = height
}

export function getChromeHeight(): number {
  return current
}
