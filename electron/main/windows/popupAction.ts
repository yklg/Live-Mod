// 弹窗「打开动作」决策（fix-shell-popup-navigation-liveend · v2 焦点契约/门控）
// 为什么独立成纯函数：原逻辑内联在 shellUI 的 setWindowOpenHandler 里，只有 E2E 能触达，
// 焦点契约（前台/后台 + 是否聚焦）与 intent 折叠分支不可单测。抽成纯决策后：
//   - 决策可枚举、可回归（单元层覆盖组合表）；
//   - 执行层（shellUI）只做副作用编排，不携带判断分支。
// 边界：本模块零 Electron 依赖；分类输入来自 popupPolicy（平台无关），intent 来自 popupIntent（会话层声明）。

import type { ShellPopupMode } from './popupIntent'
import type { PopupDecision } from './popupPolicy'

/** 执行层需要落地的动作类型（deny 无副作用；external 走系统浏览器；navigate 折叠当前页；new-tab 新 Tab） */
export type PopupOpenKind = 'deny' | 'external' | 'navigate' | 'new-tab'

export interface PopupOpenAction {
  kind: PopupOpenKind
  /**
   * 仅 new-tab 有效：新 Tab 是否前台激活并接管键盘焦点。
   * 门控规则（v2）：opener Tab 为当前 active → 前台；后台页自发弹窗 → 后台（防抢焦点）。
   */
  activate: boolean
  /** 结构化原因（日志/测试断言用，稳定词表） */
  reason: PopupOpenReason
}

export type PopupOpenReason =
  | 'deny-selfdup'
  | 'external'
  | 'unexpected-allow'
  | 'intent-navigate'
  | 'new-tab-foreground'
  | 'new-tab-background'

export interface PopupOpenInput {
  decision: PopupDecision
  /** 会话层声明的弹窗意图（'navigate' = 登录/刷新窗口期折叠当前页） */
  intentMode: ShellPopupMode | null
  /** opener Tab 是否当前 active（由 shellUI 用 tabManager.activeWebContentsId() 计算） */
  openerActive: boolean
}

/**
 * 决策表（顺序即优先级）：
 * 1. 自复制弹窗 → deny（反嵌入逃逸，页面留壳内）
 * 2. view 档出现 allow（不应发生）→ deny（防御，不打开任何窗口）
 * 3. 外链 → external（系统浏览器）
 * 4. 登录窗口期 navigate 意图 → 同页折叠（自动化链路契约）
 * 5. 其余业务弹窗 → 壳内新 Tab；opener active 时前台并聚焦，否则后台（不抢焦点）
 */
export function resolvePopupOpenAction({
  decision,
  intentMode,
  openerActive,
}: PopupOpenInput): PopupOpenAction {
  if (decision === 'deny-selfdup') {
    return { kind: 'deny', activate: false, reason: 'deny-selfdup' }
  }
  if (decision === 'allow') {
    // view 档不应出现 allow：窗口档 click 弹窗走 allow 分支，与本函数无关
    return { kind: 'deny', activate: false, reason: 'unexpected-allow' }
  }
  if (decision === 'external') {
    return { kind: 'external', activate: false, reason: 'external' }
  }
  // decision === 'new-tab'
  if (intentMode === 'navigate') {
    return { kind: 'navigate', activate: false, reason: 'intent-navigate' }
  }
  return {
    kind: 'new-tab',
    activate: openerActive,
    reason: openerActive ? 'new-tab-foreground' : 'new-tab-background',
  }
}

// ==================== 兜底导航抑制（官方页 if(!w) location.href） ====================

export interface PendingPopupNav {
  /** 已由新 Tab 承载的弹窗 URL（规范化前原值） */
  url: string
  /** 抑制窗口截止时间（epoch ms） */
  expiresAt: number
}

/**
 * 归一化：只比较 origin+pathname+search（与弹窗分类口径一致，忽略 hash）。
 * 非法 URL 原样返回（保持“不猜测”的保守语义）。
 */
export function normalizePopupUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

/**
 * 该次页面导航是否属于「已被新 Tab 承载的弹窗」的兜底跳转，应被抑制：
 * - 无待处理弹窗 → false
 * - 已过期 → false（调用方负责清理过期状态）
 * - URL 规范化后不相等 → false（只拦同一目标，绝不误伤用户正常导航）
 */
export function shouldSuppressFallbackNavigation(
  pending: PendingPopupNav | null,
  targetUrl: string,
  now: number,
): boolean {
  if (!pending) return false
  if (now > pending.expiresAt) return false
  return normalizePopupUrl(targetUrl) === normalizePopupUrl(pending.url)
}
