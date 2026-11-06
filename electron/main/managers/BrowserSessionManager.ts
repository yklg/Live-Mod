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
import { shellWindowManager } from '#/windows/shellWindowManager'

export interface BrowserSession {
  /** C1 生命周期守卫根基：launched=Playwright 起进程；attached=CDP attach 回 Electron 自身 */
  kind: SessionKind
  browser: playwright.Browser
  context: playwright.BrowserContext
  page: playwright.Page
  /** attached 专属：所属壳窗口 id（日志/崩溃重建用） */
  shellWindowId?: number
  /** attached 专属：拆除壳承载体（窗口模式=关窗；单窗口模式=移除 pageView）。断开时由会话层调用 */
  disposeShell?: () => Promise<void>
}

/** attach 会话建立失败的可判别错误（ipc 层据此执行 F3 降级回退） */
export class AttachSessionError extends Error {
  constructor(
    readonly reason: 'cdp-endpoint' | 'nonce-timeout' | 'connect-failed',
    message: string,
  ) {
    super(message)
    this.name = 'AttachSessionError'
  }
}

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
    return { kind: 'launched', browser, context, page }
  }

  /**
   * attach 会话（R1'，browser-shell-formalization-plan v3 Phase 0/1）：
   * ShellWindowManager 建窗（产 nonce）→ CDP endpoint 解析 → connectOverCDP →
   * pageFactory 按 nonce 精确寻址 → 会话组装。任务层拿到的 Page 与 launched 完全同形。
   * 失败一律归约 AttachSessionError，由 ipc 层执行 F3 降级回退。
   */
  public async createAttachedSession(accountId: string): Promise<BrowserSession> {
    const logger = createLogger('AttachSession')
    const handle = shellWindowManager.open(accountId)

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

    logger.success('attach 会话建立成功，壳窗口：', handle.windowId)
    return {
      kind: 'attached',
      browser,
      context,
      page,
      shellWindowId: handle.windowId,
      disposeShell: handle.disposeWindow,
    }
  }
}

export const browserManager = new BrowserSessionManager()
