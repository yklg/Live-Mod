// PageDriver seam 原型（browser-shell-poc-plan v5 §三/§五.1）
// 接口形状 = 任务层实际用到的 playwright.Page 子集。
// PoC-0 是第一消费者；正式化后 IPlatform 的 getXxxPage(): Page 迁移为本接口。
import type { Browser, BrowserContext, Page } from 'playwright'

/**
 * 会话来源类型（C1 生命周期约束的根基）：
 * - launched：Playwright 启动的独立浏览器进程，close = 结束进程（现状行为）
 * - attached：connectOverCDP attach 回 Electron 自身，断开 = 仅断连接，
 *   绝不能对 attached browser 调用会终止宿主的关闭路径（PoC-0f 实测语义）
 */
export type SessionKind = 'launched' | 'attached'

export interface DriverSession {
  kind: SessionKind
  browser: Browser
  context: BrowserContext
  page: Page
}

/**
 * 任务层依赖的 Page 能力子集（由 PoC-0g 实测划界）。
 * 文档用途：R1' 下 Playwright API 即驱动，本接口仅作契约说明；
 * Phase 3 末仍无第二实现者即删除（防幽灵代码，v2 评审 P2-2）。
 */
export interface PageDriverLike {
  goto(url: string): Promise<void>
  evaluate<T>(fn: () => T): Promise<T>
  waitForSelector(selector: string): Promise<void>
  locator: Page['locator']
}

/**
 * 会话统一拆除入口（C1 生命周期守卫，browser-shell-formalization-plan v3）。
 * 契约（teardown.test.ts TC-U1~U3b 固化）：
 * - 两种 kind 均且仅调用 browser.close() 一次：launched=结束进程；
 *   attached=Playwright 语义仅断 CDP 连接，不杀宿主（PoC-0f 实测，E2E TC-E1 终验）。
 * - 绝不触碰 Page/Context 的 close——attached 下关页面=关壳窗口；跨 session 关页面=越权。
 * - 幂等：同一 session 重复 teardown 不二次 close（WeakSet 守卫）。
 */
const tornSessions = new WeakSet<object>()

export async function teardownSession(
  session: Pick<DriverSession, 'kind' | 'browser'>,
): Promise<void> {
  if (tornSessions.has(session)) return
  tornSessions.add(session)
  await session.browser.close()
}
