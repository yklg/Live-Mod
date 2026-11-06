import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== BrowserSession 能力扩展契约测试（fix-shell-popup-navigation-liveend A4）=====
// 平台层将经这两个可选能力消费（IPlatform 适配器）：
// - setPopupMode：仅 attached+壳 UI 提供（登录窗口期 'navigate' / 浏览器语义 null）；
//   launched 与窗口承载模式不提供（弹窗天然是新窗口/新页）。
// - createAuxPage：launched=context.newPage()；attached=壳层隐藏窗口 + nonce 寻址，
//   失败必须 dispose 隐藏窗口（防泄漏）并向上抛。
// 本文件用 fake electron/playwright 校验接口形状与失败兜底，不启动真实浏览器。

const h = vi.hoisted(() => {
  type PopupMode = 'navigate' | null
  interface AuxHandle {
    nonce: string
    windowId: number
    disposeWindow: () => Promise<void>
  }

  const state = {
    shellUIEnabled: true,
    popupIntentCalls: [] as Array<{ wcId: number; mode: PopupMode }>,
    openCalls: [] as Array<{ accountId: string; opts?: unknown }>,
    openAuxCalls: [] as string[],
    /** 用例可替换 openAux 返回值（默认每次新建独立句柄） */
    auxHandleOverride: null as AuxHandle | null,
  }

  class FakeNonceTimeoutError extends Error {
    readonly code = 'nonce-timeout'
    constructor(nonce: string) {
      super(`nonce 寻址超时: ${nonce}`)
      this.name = 'NonceTimeoutError'
    }
  }

  const chromium = { use: vi.fn(), launch: vi.fn(), connectOverCDP: vi.fn() }
  const resolveCdpEndpoint = vi.fn()
  const locateByNonce = vi.fn()
  const findChromium = vi.fn(async () => '/fake/chrome')
  const markStealthOff = vi.fn()
  const setPopupMode = vi.fn((wcId: number, mode: PopupMode) => {
    state.popupIntentCalls.push({ wcId, mode })
  })
  const shellWindowManager = {
    open: vi.fn((accountId: string, opts?: unknown) => {
      state.openCalls.push({ accountId, opts })
      return {
        nonce: 'main-nonce',
        windowId: 101,
        disposeWindow: vi.fn(async () => {}),
      }
    }),
    openAux: vi.fn((accountId: string): AuxHandle => {
      state.openAuxCalls.push(accountId)
      return (
        state.auxHandleOverride ?? {
          nonce: 'lm-aux-nonce',
          windowId: 202,
          disposeWindow: vi.fn(async () => {}),
        }
      )
    }),
  }

  function makePage(overrides: Record<string, unknown> = {}) {
    return {
      goto: vi.fn(async () => {}),
      url: vi.fn(() => 'about:blank'),
      context: vi.fn(),
      ...overrides,
    }
  }

  function makeContext() {
    const pages: Array<ReturnType<typeof makePage>> = []
    const context = {
      newPage: vi.fn(async () => {
        const page = makePage({ context: () => context })
        pages.push(page)
        return page
      }),
      addInitScript: vi.fn(async () => {}),
      storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
      pages: () => pages,
    }
    return context
  }

  function makeBrowser(context: ReturnType<typeof makeContext>) {
    return {
      newContext: vi.fn(async () => context),
      contexts: () => [context],
      close: vi.fn(async () => {}),
    }
  }

  return {
    state,
    FakeNonceTimeoutError,
    chromium,
    resolveCdpEndpoint,
    locateByNonce,
    findChromium,
    markStealthOff,
    setPopupMode,
    shellWindowManager,
    makePage,
    makeContext,
    makeBrowser,
  }
})

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp/lm-test' } }))

vi.mock('playwright-extra', () => ({ chromium: h.chromium }))
vi.mock('puppeteer-extra-plugin-stealth', () => ({ default: () => ({ name: 'stealth' }) }))
vi.mock('#/driver/cdpEndpoint', () => ({ resolveCdpEndpoint: h.resolveCdpEndpoint }))
vi.mock('#/driver/pageFactory', () => ({
  locateByNonce: h.locateByNonce,
  NonceTimeoutError: h.FakeNonceTimeoutError,
}))
vi.mock('#/logger', () => {
  const stub = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    scope: () => stub,
  }
  return { createLogger: () => stub }
})
vi.mock('#/platforms/runtimeEnvState', () => ({
  runtimeEnvState: { markStealthOff: h.markStealthOff },
}))
vi.mock('#/utils/checkChrome', () => ({ findChromium: h.findChromium }))
vi.mock('#/windows/popupIntent', () => ({ setPopupMode: h.setPopupMode }))
vi.mock('#/windows/shellUI', () => ({ isShellUIEnabled: () => h.state.shellUIEnabled }))
vi.mock('#/windows/shellWindowManager', () => ({ shellWindowManager: h.shellWindowManager }))

import { browserManager } from '../BrowserSessionManager'

beforeEach(() => {
  h.state.shellUIEnabled = true
  h.state.popupIntentCalls.length = 0
  h.state.openCalls.length = 0
  h.state.openAuxCalls.length = 0
  h.state.auxHandleOverride = null
  h.chromium.launch.mockReset()
  h.chromium.connectOverCDP.mockReset()
  h.resolveCdpEndpoint.mockReset()
  h.locateByNonce.mockReset()
  h.shellWindowManager.open.mockClear()
  h.shellWindowManager.openAux.mockClear()
})

describe('BrowserSession 能力扩展（launched）', () => {
  it('TC-CAP1 createAuxPage = context.newPage()（有 url 时 goto）；不提供 setPopupMode', async () => {
    const context = h.makeContext()
    const browser = h.makeBrowser(context)
    h.chromium.launch.mockResolvedValue(browser)

    const session = await browserManager.createSession(false)
    expect(session.kind).toBe('launched')
    expect(session.accountId).toBeUndefined()
    expect(session.setPopupMode).toBeUndefined()
    expect(typeof session.createAuxPage).toBe('function')

    const aux = await session.createAuxPage!()
    expect(context.newPage).toHaveBeenCalledTimes(2) // 会话主页面 + 辅助页
    expect(aux.goto).not.toHaveBeenCalled()

    const auxWithUrl = await session.createAuxPage!({ url: 'https://compass.example.com/live' })
    expect(auxWithUrl.goto).toHaveBeenCalledWith('https://compass.example.com/live')
  })
})

describe('BrowserSession 能力扩展（attached）', () => {
  async function setupAttached() {
    const context = h.makeContext()
    const browser = h.makeBrowser(context)
    h.resolveCdpEndpoint.mockReturnValue({ ok: true, wsEndpoint: 'ws://127.0.0.1:1/devtools' })
    h.chromium.connectOverCDP.mockResolvedValue(browser)
    const sessionPage = h.makePage({ context: () => context })
    h.locateByNonce.mockResolvedValue(sessionPage)
    const session = await browserManager.createAttachedSession('acc-1')
    return { session, sessionPage, context, browser }
  }

  it('TC-CAP2 壳 UI 模式：setPopupMode 转发到 popupIntent(webContentsId=pageView id)；accountId 保存', async () => {
    const { session } = await setupAttached()

    expect(session.kind).toBe('attached')
    expect(session.accountId).toBe('acc-1')
    expect(session.shellWindowId).toBe(101)
    expect(session.disposeShell).toBeDefined()
    expect(typeof session.setPopupMode).toBe('function')

    session.setPopupMode!('navigate')
    session.setPopupMode!(null)
    expect(h.state.popupIntentCalls).toEqual([
      { wcId: 101, mode: 'navigate' },
      { wcId: 101, mode: null },
    ])
  })

  it('TC-CAP3 非壳 UI（窗口承载）模式：不提供 setPopupMode（弹窗走 allow 真窗口）', async () => {
    h.state.shellUIEnabled = false
    const { session } = await setupAttached()
    expect(session.setPopupMode).toBeUndefined()
  })

  it('TC-CAP4 createAuxPage：隐藏窗口 nonce 寻址成功 → goto 目标 URL（不 dispose）', async () => {
    const { session, browser } = await setupAttached()
    const auxPage = h.makePage()
    const auxHandle = {
      nonce: 'lm-aux-nonce',
      windowId: 202,
      disposeWindow: vi.fn(async () => {}),
    }
    h.state.auxHandleOverride = auxHandle
    h.locateByNonce.mockResolvedValueOnce(auxPage)

    const page = await session.createAuxPage!({ url: 'https://compass.example.com/live' })

    expect(page).toBe(auxPage)
    expect(h.state.openAuxCalls).toEqual(['acc-1'])
    expect(h.locateByNonce).toHaveBeenLastCalledWith({
      browser,
      nonce: auxHandle.nonce,
      disposeWindow: auxHandle.disposeWindow,
    })
    expect(auxPage.goto).toHaveBeenCalledWith('https://compass.example.com/live')
    expect(auxHandle.disposeWindow).not.toHaveBeenCalled()
  })

  it('TC-CAP5 createAuxPage 寻址失败：disposeWindow 兜底（不泄漏隐藏窗口）并向上抛', async () => {
    const { session } = await setupAttached()
    // 让 openAux 返回本次可断言的句柄
    const auxHandle = {
      nonce: 'lm-aux-nonce',
      windowId: 202,
      disposeWindow: vi.fn(async () => {}),
    }
    h.state.auxHandleOverride = auxHandle
    h.locateByNonce.mockRejectedValueOnce(new h.FakeNonceTimeoutError('lm-aux-nonce'))

    await expect(session.createAuxPage!()).rejects.toThrow('nonce 寻址超时')
    expect(auxHandle.disposeWindow).toHaveBeenCalledTimes(1)
  })

  it('TC-CAP6 createAuxPage 寻址成功后 goto 失败：同样 disposeWindow 并向上抛', async () => {
    const { session } = await setupAttached()
    const auxHandle = {
      nonce: 'lm-aux-nonce',
      windowId: 202,
      disposeWindow: vi.fn(async () => {}),
    }
    h.state.auxHandleOverride = auxHandle
    const auxPage = h.makePage({
      goto: vi.fn(async () => Promise.reject(new Error('net::ERR_FAILED'))),
    })
    h.locateByNonce.mockResolvedValueOnce(auxPage)

    await expect(
      session.createAuxPage!({ url: 'https://compass.example.com/live' }),
    ).rejects.toThrow('net::ERR_FAILED')
    expect(auxHandle.disposeWindow).toHaveBeenCalledTimes(1)
  })
})
