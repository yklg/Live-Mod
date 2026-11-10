import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type playwright from 'playwright'
import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
import { resolveCdpEndpoint } from '#/driver/cdpEndpoint'
import { locateByNonce, NonceTimeoutError } from '#/driver/pageFactory'
import type { SessionKind } from '#/driver/types'
import { createLogger } from '#/logger'
import { runtimeEnvState } from '#/platforms/runtimeEnvState'
import { findChromium } from '#/utils/checkChrome'
import { setPopupMode as setShellPopupMode } from '#/windows/popupIntent'
import { isShellUIEnabled } from '#/windows/shellUI'
import { shellWindowManager } from '#/windows/shellWindowManager'

export interface BrowserSession {
  /** C1 生命周期守卫根基：launched=Playwright 起进程；attached=CDP attach 回 Electron 自身 */
  kind: SessionKind
  browser: playwright.Browser
  context: playwright.BrowserContext
  page: playwright.Page
  /** attached 专属：会话所属账号 id（辅助页 partition / 日志；launched 无） */
  accountId?: string
  /** attached 专属：所属壳窗口 id（日志/崩溃重建用；壳 UI 模式下即账号 pageView 的 webContents.id） */
  shellWindowId?: number
  /** attached 专属：拆除壳承载体（窗口模式=关窗；单窗口模式=移除 pageView）。断开时由会话层调用 */
  disposeShell?: () => Promise<void>
  /**
   * attached 壳模式专属（fix-shell-popup-navigation-liveend Phase 2 · 会话层↔壳层弹窗契约）：
   * 声明本会话页后续弹窗语义 — 'navigate'=官方页 window.open 折叠为当前页导航（登录窗口期旧语义），
   * null=浏览器语义（壳内新 Tab）。登录/进中控台等自动化链路在需要「同页折叠」时成对使用。
   * 不提供本方法的场景：launched（弹窗天然是新页）、窗口承载模式（弹窗是 allow 真窗口，无需意图）。
   */
  setPopupMode?: (mode: 'navigate' | null) => void
  /**
   * 辅助页能力（seamless-fix §C / A4）：补偿 attached 下 `context.newPage()` 不可用的缺口。
   * launched=context.newPage()；attached=壳层隐藏窗口新建 target + nonce 寻址。
   * 用途：罗盘大屏等只被 app 监听的页面。调用方负责在不再需要时 close 返回的 Page。
   */
  createAuxPage?: (opts?: { url?: string }) => Promise<playwright.Page>
}

/** attach 会话建立失败的可判别错误（ipc 层据此分流；壳 v3 · Wave 1 移入 errors/ 目录以便独立测试） */
import { AttachSessionError } from '#/errors/AttachSessionError'
export { AttachSessionError }

export interface BrowserConfig {
  headless?: boolean
  storageState?: string
}

export type StorageState = playwright.BrowserContextOptions['storageState']

chromium.use(stealth())

class BrowserSessionManager {
  private chromePath: string | null = null

  public setChromePath(path: string) {
    this.chromePath = path
  }

  private async getChromePathOrDefault() {
    if (!this.chromePath) {
      this.chromePath = await findChromium()
    }
    return this.chromePath
  }

  private async createBrowser(headless = true) {
    const path = await this.getChromePathOrDefault()
    return chromium.launch({
      headless,
      executablePath: path,
    })
  }

  public async createSession(
    headless = true,
    storageState?: StorageState,
  ): Promise<BrowserSession> {
    const browser = await this.createBrowser(headless)
    const context = await browser.newContext({
      viewport: null, // 显式设置 null，关闭固定视口
      storageState,
    })
    const page = await context.newPage()
    const session: BrowserSession = { kind: 'launched', browser, context, page }
    // launched 的新页面就是浏览器上下文里的普通 Tab：createAuxPage 直接用它。
    // 不提供 setPopupMode——launched 弹窗天然是新页面，无「折叠当前页 vs 新 Tab」语义选择。
    session.createAuxPage = async (opts?: { url?: string }) => {
      const auxPage = await context.newPage()
      if (opts?.url) await auxPage.goto(opts.url)
      return auxPage
    }
    return session
  }

  /**
   * attach 会话（R1'，browser-shell-formalization-plan v3 Phase 0/1）：
   * ShellWindowManager 建窗（产 nonce）→ CDP endpoint 解析 → connectOverCDP →
   * pageFactory 按 nonce 精确寻址 → 会话组装。任务层拿到的 Page 与 launched 完全同形。
   * 失败一律归约 AttachSessionError（壳 v3 · Wave 1：由 ipc 层按 kind 如实上报失败，
   * **不再**执行 F3 降级回退——换形态继续跑正是"为什么还会出现回退降级"的根因）。
   */
  public async createAttachedSession(
    accountId: string,
    opts?: { popupOrigins?: readonly string[] },
  ): Promise<BrowserSession> {
    const logger = createLogger('AttachSession')
    const handle = shellWindowManager.open(accountId, opts)

    const endpoint = resolveCdpEndpoint({
      isDev: !app.isPackaged,
      env: process.env,
      readPortFile: () => {
        try {
          return readFileSync(join(app.getPath('userData'), 'DevToolsActivePort'), 'utf8')
        } catch {
          return null
        }
      },
    })
    if (!endpoint.ok || !endpoint.wsEndpoint) {
      await handle.disposeWindow()
      throw new AttachSessionError('cdp-endpoint', `CDP endpoint 不可用: ${endpoint.reason}`)
    }

    let browser: playwright.Browser
    try {
      browser = await chromium.connectOverCDP(endpoint.wsEndpoint)
    } catch (e) {
      await handle.disposeWindow()
      throw new AttachSessionError('connect-failed', `connectOverCDP 失败: ${e}`)
    }

    let page: playwright.Page
    try {
      page = await locateByNonce({
        browser: browser as never,
        nonce: handle.nonce,
        disposeWindow: handle.disposeWindow,
      })
    } catch (e) {
      await browser.close().catch(() => {})
      throw e instanceof NonceTimeoutError
        ? new AttachSessionError('nonce-timeout', e.message)
        : new AttachSessionError('connect-failed', `${e}`)
    }

    const context = page.context()
    // Phase 1.3 stealth on attach：playwright-extra 的 stealth 插件作用于 launch/connect；
    // attach 路径显式补挂 webdriver 掩蔽作双保险（PoC-0c 实证通道）。失败=F4：放行+标记。
    try {
      await context.addInitScript({
        content: `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`,
      })
    } catch (e) {
      runtimeEnvState.markStealthOff(accountId)
      logger.warn('stealth attach 掩蔽失败（F4 放行+标记）：', e)
    }

    // 保活不变量（v2，契约以测试为准）：attach 会话存活期间，会话页在「Tab 非激活 / 窗口最小化 / 长驻」
    // 下仍可被 Playwright 操作、页面定时器不被冻结——这是「用户切走页面后自动讲解仍生效」的前提。
    // 契约回归：poc/shell/e2e-tab-liveness.mjs（非激活/最小化）；实现依据为 CDP attach 的 active lifecycle（实测）。
    logger.success('attach 会话建立成功，壳窗口：', handle.windowId)
    const session: BrowserSession = {
      kind: 'attached',
      browser,
      context,
      page,
      accountId,
      shellWindowId: handle.windowId,
      disposeShell: handle.disposeWindow,
    }

    // 弹窗意图（Phase 2）：只有单窗口壳 UI 存在「折叠当前页 or 壳内新 Tab」的语义选择，
    // 且 handle.windowId 此时确是 pageView 的 webContents.id（窗口模式下是 BrowserWindow.id，
    // 其弹窗走 allow 真窗口 = 浏览器语义，不该也不适用意图表）。平台层经可选方法消费，无感。
    if (isShellUIEnabled()) {
      session.setPopupMode = mode => setShellPopupMode(handle.windowId, mode)
    }

    // 辅助页（A4）：attach 下 context.newPage() 不可用（Target.createTarget 不支持 pageView），
    // 改由壳层隐藏窗口新建独立 target，再用 nonce 精确寻址（判据仍是 URL 后缀，pageFactory 契约不变）。
    session.createAuxPage = async (opts?: { url?: string }) => {
      const aux = shellWindowManager.openAux(accountId)
      try {
        const auxPage = await locateByNonce({
          browser: browser as never,
          nonce: aux.nonce,
          disposeWindow: aux.disposeWindow,
        })
        if (opts?.url) await auxPage.goto(opts.url)
        return auxPage
      } catch (e) {
        // locateByNonce 超时会自行 dispose；此处兜住「寻址成功后 goto 失败」等路径，防隐藏窗口泄漏
        await aux.disposeWindow().catch(() => {})
        throw e
      }
    }

    return session
  }
}

export const browserManager = new BrowserSessionManager()
