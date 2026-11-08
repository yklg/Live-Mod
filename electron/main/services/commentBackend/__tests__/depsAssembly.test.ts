import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// ===== B2 依赖装配契约（TC-BH1~BH2，源码扫描 + 行为断言）=====
// 守护不变量：
//   C-BH1 `BackendPageHandle` 只允许经 toPageHandle 构造（手写 {page, close} 会漏掉 isConnected，
//          使"进程死亡"永远检测不到 —— 实测故障：headless Chrome 被系统杀掉后仍报 live）
//   C-BH2 toPageHandle 必须把 Browser.isConnected 接出来（探针存在 ≠ 探针生效）
//
// 为什么是源码扫描：AccountSession 装配块依赖 electron 全局与真实 BrowserSession，
// 单测只能靠 mock 覆盖到"我们自己写的 mock"，无法覆盖"漏写字段"这类缺失 ——
// 而缺失恰恰是这次的真实缺陷形态（假绿 F6）。

vi.mock('#/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  }),
}))

import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { toPageHandle } from '#/services/commentBackend/contracts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SESSION_SRC = path.join(HERE, '../../../services/AccountSession.ts')

function readSessionSource(): string {
  return fs.readFileSync(SESSION_SRC, 'utf8')
}

describe('B2 依赖装配（TC-BH1~BH2）', () => {
  it('TC-BH1 AccountSession 的 createSession 必须复用 toPageHandle（不得手写页面句柄）', () => {
    const src = readSessionSource()

    // 正向：必须存在对唯一适配点的调用
    expect(src).toMatch(/toPageHandle\s*\(\s*launched\s*\)/)
    // 反向：不得再出现手写句柄的两个特征（page 直传 / 内联 close）
    expect(src).not.toMatch(/page:\s*launched\.page/)
    expect(src).not.toMatch(/close:\s*async\s*\(\)\s*=>\s*\{\s*await\s+launched\.browser\.close/)
  })

  it('TC-BH2 toPageHandle 把浏览器存活状态接出来（isConnected 不是摆设）', () => {
    let alive = true
    const fake = {
      kind: 'launched',
      page: {} as never,
      browser: {
        isConnected: () => alive,
        close: async () => {},
      },
    } as unknown as BrowserSession

    const handle = toPageHandle(fake)

    expect(typeof handle.isConnected).toBe('function')
    expect(handle.isConnected?.()).toBe(true)

    alive = false
    expect(handle.isConnected?.()).toBe(false)
  })
})
