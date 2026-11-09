import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== shellWindowManager.openAux 契约测试（fix-shell-popup-navigation-liveend A4）=====
// 辅助页承载体：attached 会话无法 context.newPage()，由壳层隐藏 BrowserWindow 新建独立 target，
// 平台层（罗盘大屏等监听页）再经 pageFactory 按 nonce 寻址。契约：
// - show:false + 1280×800，webPreferences 与壳窗口同口径（同 partition / 无 preload / 隔离上下文）；
// - UA 对齐 chromeUa（防官方风控识别 Electron）；外部协议守卫与窗口档一致；
// - 先 about:blank#<nonce> 标记页；窗口登记 Map，disposeWindow 关窗 + 移除，幂等。

const h = vi.hoisted(() => {
  let seq = 0
  const installExternalProtocolGuard = vi.fn()

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    id: number
    options: {
      show?: boolean
      width?: number
      height?: number
      webPreferences?: Record<string, unknown>
    }
    destroyed = false
    webContents = (() => {
      const listeners = new Map<string, Array<() => void>>()
      return {
        setUserAgent: vi.fn(),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        executeJavaScript: vi.fn(async () => {}),
        getURL: () => 'about:blank',
        once: vi.fn((event: string, fn: () => void) => {
          const list = listeners.get(event) ?? []
          const wrapped = () => {
            fn()
            listeners.set(
              event,
              (listeners.get(event) ?? []).filter(f => f !== wrapped),
            )
          }
          list.push(wrapped)
          listeners.set(event, list)
        }),
        fire: (event: string) => {
          for (const fn of [...(listeners.get(event) ?? [])]) fn()
        },
      }
    })()
    loadURL = vi.fn(async () => {})
    isDestroyed = vi.fn(() => this.destroyed)
    close = vi.fn(() => {
      this.destroyed = true
      this.fire('closed')
    })
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    constructor(options: FakeBrowserWindow['options']) {
      this.options = options
      this.id = ++seq
      FakeBrowserWindow.instances.push(this)
    }

    on(event: string, fn: (...args: unknown[]) => void) {
      const list = this.listeners.get(event) ?? []
      list.push(fn)
      this.listeners.set(event, list)
    }

    once(event: string, fn: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        fn(...args)
        const list = this.listeners.get(event) ?? []
        this.listeners.set(
          event,
          list.filter(f => f !== wrapped),
        )
      }
      this.on(event, wrapped)
    }

    fire(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args)
    }
  }

  return {
    installExternalProtocolGuard,
    FakeBrowserWindow,
    resetInstances: () => {
      FakeBrowserWindow.instances.length = 0
    },
  }
})

vi.mock('electron', () => ({ BrowserWindow: h.FakeBrowserWindow }))
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
vi.mock('#/windows/externalProtocolGuard', () => ({
  installExternalProtocolGuard: h.installExternalProtocolGuard,
}))
vi.mock('#/windows/popupPolicy', () => ({ classifyPopup: vi.fn(() => 'external') }))
vi.mock('#/windows/shellTabManager', () => ({
  accountTabPartition: (accountId: string) => `persist:lm-shell-${accountId}`,
}))
vi.mock('#/windows/shellUI', () => ({
  ensureAccountTab: vi.fn(),
  isShellUIEnabled: () => false,
}))
vi.mock('#/windows/ua', () => ({ chromeUa: () => 'Fake-Chrome-UA' }))

import { shellWindowManager } from '../../windows/shellWindowManager'

beforeEach(() => {
  h.resetInstances()
  h.installExternalProtocolGuard.mockClear()
})

describe('shellWindowManager.openAux（隐藏辅助页窗口）', () => {
  it('TC-AUX1 创建隐藏窗口：show:false/1280×800/同 partition/无 preload，UA + 外链守卫 + nonce 标记页', () => {
    const handle = shellWindowManager.openAux('acc-1')
    const win = h.FakeBrowserWindow.instances.at(-1)!

    expect(win.options.show).toBe(false)
    expect(win.options.width).toBe(1280)
    expect(win.options.height).toBe(800)
    expect(win.options.webPreferences).toEqual({
      // 同 partition 才能与账号会话共享登录态；无 preload / 隔离上下文 = 不给远程官方页 IPC 面
      partition: 'persist:lm-shell-acc-1',
      contextIsolation: true,
      nodeIntegration: false,
    })
    expect(win.options.webPreferences).not.toHaveProperty('preload')
    expect(win.webContents.setUserAgent).toHaveBeenCalledWith('Fake-Chrome-UA')
    expect(h.installExternalProtocolGuard).toHaveBeenCalledWith(
      win.webContents,
      expect.any(Function),
    )
    // 与壳窗口同规程：先 about:blank#nonce，寻址成功后由调用方 goto
    expect(win.loadURL).toHaveBeenCalledWith(`about:blank#${handle.nonce}`)
    expect(handle.windowId).toBe(win.id)
    expect(shellWindowManager.get(win.id)).toBe(win)
  })

  it('TC-AUX2 disposeWindow 关窗并从 Map 移除；重复调用幂等', async () => {
    const handle = shellWindowManager.openAux('acc-1')
    const win = h.FakeBrowserWindow.instances.at(-1)!

    await handle.disposeWindow()
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(win.isDestroyed()).toBe(true)
    expect(shellWindowManager.get(win.id)).toBeUndefined()

    await expect(handle.disposeWindow()).resolves.toBeUndefined()
    expect(win.close).toHaveBeenCalledTimes(1) // 已销毁：不二次 close
  })

  it('TC-AUX4 webContents 先被销毁（消费者 page.close()）时兜底关窗，防隐藏窗口残留', () => {
    const handle = shellWindowManager.openAux('acc-1')
    const win = h.FakeBrowserWindow.instances.at(-1)!

    win.webContents.fire('destroyed')

    expect(win.close).toHaveBeenCalledTimes(1)
    expect(shellWindowManager.get(handle.windowId)).toBeUndefined()
  })

  it('TC-AUX3 nonce 带账号与 aux 标识且唯一；窗口外部销毁时自动从 Map 移除', () => {
    const a = shellWindowManager.openAux('acc-1')
    const b = shellWindowManager.openAux('acc-1')
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.nonce.startsWith('lm-aux-nonce-acc-1-')).toBe(true)

    const winA = h.FakeBrowserWindow.instances[0]
    winA.fire('closed') // 用户/系统销毁窗口（非 disposeWindow 路径）
    expect(shellWindowManager.get(winA.id)).toBeUndefined()
    expect(shellWindowManager.get(h.FakeBrowserWindow.instances[1].id)).toBeDefined()
  })
})
