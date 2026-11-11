import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 连接失败分类与通知契约（壳 v3 · Wave 1 · P0-1）=====
// 守护不变量：
//   CV-I01 成功 → {ok:true}；渲染层弹 1 次成功 toast，0 次错误 toast
//   CV-I02 **aborted 静默**：{ok:false,aborted:true} → 0 次 toast、0 条通知、不抛错
//   CV-I03 失败后状态复位（不残留 connecting）
//   CV-I04 **单份通知**：真失败 → pushNotice 恰好 1 条，渲染层 0 次错误 toast
//   CV-I05 失败后可重建：第一次失败 → 第二次成功 → 状态 connected
//   CV-I09 结构化日志含 connectId / mode / platform / kind / reason
//   CV-I10 degraded 删除后决策表（见 envResolution.test.ts）
//   CV-I18 类型表 ↔ handler ↔ renderer 三方同源
//   CV-I20 mock 保真度：mock 形状若退回 boolean，用例必须变红（不能假绿）
//
// 判据纪律：全部用**计数断言**（toast 调用次数 / pushNotice 调用次数），
// 不用"看起来没有报错"这类主观描述。

const h = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const pushNotice = vi.fn((_input: unknown) => true)
  const hideEntry = vi.fn()
  const isShellUIEnabled = vi.fn(() => true)
  const shellModeSet = vi.fn()
  const setChromePath = vi.fn()
  const closeSession = vi.fn()
  const createSession = vi.fn()
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    scope: vi.fn(),
  }
  logger.scope.mockReturnValue(logger)
  return {
    handlers,
    pushNotice,
    hideEntry,
    isShellUIEnabled,
    shellModeSet,
    setChromePath,
    closeSession,
    createSession,
    logger,
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {} },
}))

// 只 mock typedIpcMainHandle：把 handler 收进本地 Map，直接调（仓内 ipcTrust.test.ts 同一范式）
vi.mock('#/utils', () => ({
  typedIpcMainHandle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ) => {
    h.handlers.set(channel, listener)
  },
}))

vi.mock('#/logger', () => ({ createLogger: () => h.logger }))

vi.mock('#/managers/AccountManager', () => ({
  accountManager: {
    createSession: (...args: unknown[]) => h.createSession(...args),
    closeSession: (...args: unknown[]) => h.closeSession(...args),
    getAccountName: () => '测试账号',
  },
}))

vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: { setChromePath: (...args: unknown[]) => h.setChromePath(...args) },
}))

vi.mock('#/windows/entryView', () => ({ hideEntry: () => h.hideEntry() }))
vi.mock('#/windows/noticeBus', () => ({ pushNotice: (input: unknown) => h.pushNotice(input) }))
vi.mock('#/windows/shellUI', () => ({
  isShellUIEnabled: () => h.isShellUIEnabled(),
  shellModeSet: (mode: string) => h.shellModeSet(mode),
}))

import type { ConnectResult } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AttachSessionError } from '#/errors/AttachSessionError'
import { ConnectionAbortedError } from '#/errors/ConnectionAbortedError'
import { setupLiveControlIpcHandlers } from '#/ipc/connection'
import { connectBranch, resolveConnectOutcome } from '@/pages/LiveControl/lib/connectOutcome'

const CONNECT = IPC_CHANNELS.tasks.liveControl.connect

const account = { id: 'acc-1', name: '测试账号' } as Account

/** 装一个可控的会话：connect 的行为由用例决定 */
function stubSession(behaviour: 'ok' | Error) {
  h.createSession.mockReturnValue({
    connect: vi.fn(async () => {
      if (behaviour === 'ok') return
      throw behaviour
    }),
  })
}

async function callConnect() {
  const handler = h.handlers.get(CONNECT)
  if (!handler) throw new Error(`未注册 handler: ${CONNECT}`)
  return (await handler(
    {},
    {
      platform: 'douyin',
      account,
      headless: false,
    },
  )) as ConnectResult
}

describe('主进程 connect handler（CV-I01/I02/I04/I05/I09）', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.pushNotice.mockClear()
    h.hideEntry.mockClear()
    h.closeSession.mockClear()
    h.createSession.mockClear()
    h.logger.info.mockClear()
    h.logger.error.mockClear()
    setupLiveControlIpcHandlers()
  })

  it('CV-I01 成功 → {ok:true}，0 条通知', async () => {
    stubSession('ok')
    const result = await callConnect()
    expect(result).toStrictEqual({ ok: true })
    expect(h.pushNotice).toHaveBeenCalledTimes(0)
  })

  it('CV-I02 用户主动断开（aborted）→ 静默：0 通知、0 错误日志、结果带 aborted 与 connectId', async () => {
    stubSession(new ConnectionAbortedError('conn-acc-1-1', 'user'))
    const result = await callConnect()
    expect(result.ok).toBe(false)
    const aborted = result as { aborted?: boolean; connectId?: string }
    expect(aborted.aborted).toBe(true)
    expect(typeof aborted.connectId).toBe('string')
    // 静默：一条通知都不推
    expect(h.pushNotice).toHaveBeenCalledTimes(0)
  })

  it('CV-I04 真失败（attach）→ pushNotice 恰好 1 条，带 kind 与 reason', async () => {
    stubSession(new AttachSessionError('cdp-endpoint', 'CDP endpoint 不可用: no port'))
    const result = await callConnect()
    expect(result).toMatchObject({ ok: false, aborted: false, kind: 'attach' })
    expect((result as { reason: string }).reason).toContain('cdp-endpoint')
    expect(h.pushNotice).toHaveBeenCalledTimes(1)
    const notice = h.pushNotice.mock.calls[0][0] as unknown as {
      variant: string
      description: string
    }
    expect(notice.variant).toBe('error')
    expect(notice.description).toContain('kind=attach')
    expect(notice.description).toContain('cdp-endpoint')
  })

  it('CV-I04b timeout 类（nonce 超时）→ kind=timeout，1 条通知', async () => {
    stubSession(new AttachSessionError('nonce-timeout', 'nonce 探测超时'))
    const result = await callConnect()
    expect(result).toMatchObject({ ok: false, kind: 'timeout' })
    expect(h.pushNotice).toHaveBeenCalledTimes(1)
  })

  it('CV-I04c 未知错误 → kind=other，1 条通知（不静默吞掉）', async () => {
    stubSession(new Error('完全没见过的异常'))
    const result = await callConnect()
    expect(result).toMatchObject({ ok: false, kind: 'other' })
    expect(h.pushNotice).toHaveBeenCalledTimes(1)
  })

  it('CV-I04d 页面被外部关闭 → kind=page-closed，且**不是** aborted（两类不得混淆）', async () => {
    stubSession(new ConnectionAbortedError('conn-acc-1-1', 'page-closed'))
    const result = await callConnect()
    expect(result).toMatchObject({ ok: false, aborted: false, kind: 'page-closed' })
    // 页面被外部关闭是要通知用户的真失败，不是静默中止
    expect(h.pushNotice).toHaveBeenCalledTimes(1)
  })

  it('CV-I05 失败后可重建：第一次失败 → 第二次成功 → {ok:true}', async () => {
    stubSession(new AttachSessionError('connect-failed', '第一次失败'))
    const first = await callConnect()
    expect(first.ok).toBe(false)

    stubSession('ok')
    const second = await callConnect()
    expect(second).toStrictEqual({ ok: true })
  })

  it('CV-I09 真失败写结构化日志：含 connectId / mode / platform / kind / reason', async () => {
    stubSession(new AttachSessionError('connect-failed', 'CDP 连不上'))
    await callConnect()
    expect(h.logger.error).toHaveBeenCalledTimes(1)
    const line = String(h.logger.error.mock.calls[0][0])
    expect(line).toContain('connectId=')
    expect(line).toContain('mode=attach')
    expect(line).toContain('platform=douyin')
    expect(line).toContain('kind=attach')
    expect(line).toContain('reason=')
  })

  it('CV-I02b aborted 走 info 级日志（不是 error），不产生失败噪音', async () => {
    stubSession(new ConnectionAbortedError('conn-acc-1-1', 'user'))
    await callConnect()
    expect(h.logger.error).toHaveBeenCalledTimes(0)
    expect(h.logger.info).toHaveBeenCalledTimes(1)
    expect(String(h.logger.info.mock.calls[0][0])).toContain('连接已中止')
  })

  it('CV-I03 失败后会话被关闭（不残留半开会话）', async () => {
    stubSession(new AttachSessionError('connect-failed', '失败'))
    await callConnect()
    expect(h.closeSession).toHaveBeenCalledTimes(1)
    expect(h.closeSession.mock.calls[0][1]).toBe('internal')
  })
})

describe('渲染层分支（CV-I01/I02/I03/I04 的 renderer 侧）', () => {
  it('CV-I01b 成功 → 状态 connected + 弹成功 toast', () => {
    const outcome = resolveConnectOutcome({ ok: true })
    expect(outcome).toStrictEqual({ status: 'connected', toast: 'success' })
    expect(connectBranch({ ok: true })).toBe('success')
  })

  it('CV-I02b aborted → 状态 disconnected + **不弹** toast（静默）', () => {
    const result = { ok: false, aborted: true, connectId: 'conn-1' } as const
    const outcome = resolveConnectOutcome(result)
    expect(outcome).toStrictEqual({ status: 'disconnected', toast: 'none' })
    expect(outcome.toast).not.toBe('success')
    expect(connectBranch(result)).toBe('aborted')
  })

  it('CV-I04b 真失败 → 状态 disconnected + 渲染层不弹 toast（通知只由主进程发，单份）', () => {
    const result = { ok: false, aborted: false, kind: 'attach', reason: 'x' } as const
    const outcome = resolveConnectOutcome(result)
    expect(outcome).toStrictEqual({ status: 'disconnected', toast: 'none' })
    expect(connectBranch(result)).toBe('failed')
  })

  it('CV-I03b 失败/中止都把状态复位为 disconnected（不残留 connecting）', () => {
    for (const result of [
      { ok: false, aborted: true, connectId: 'c' } as const,
      { ok: false, aborted: false, kind: 'other', reason: 'r' } as const,
    ]) {
      expect(resolveConnectOutcome(result).status).toBe('disconnected')
    }
  })
})

describe('契约同源与 mock 保真度（CV-I18 / CV-I20）', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('CV-I18 ConnectResult 字段集合 = handler 返回 = renderer 读取', () => {
    const typeSrc = read('../../../../shared/electron-api.d.ts')
    const handlerSrc = read('../connection.ts')
    const rendererSrc = read('../../../../src/pages/LiveControl/lib/connectOutcome.ts')

    // 1) 类型表声明的字段（整段扫描，不依赖行首——同一行可能写多个字段）
    const start = typeSrc.indexOf('export type ConnectResult')
    const end = typeSrc.indexOf('export interface IpcChannels', start)
    const block = typeSrc.slice(start, end === -1 ? undefined : end)
    const fields = new Set(
      [...block.matchAll(/\b(ok|aborted|connectId|reason|kind)\??\s*:/g)].map(m => m[1]),
    )
    expect(fields).toStrictEqual(new Set(['ok', 'aborted', 'connectId', 'reason', 'kind']))

    // 2) handler 三种返回形态都带上了这些字段
    expect(handlerSrc).toContain('ok: true')
    expect(handlerSrc).toContain('ok: false')
    expect(handlerSrc).toContain('aborted: true')
    expect(handlerSrc).toContain('connectId')
    expect(handlerSrc).toContain('reason')
    expect(handlerSrc).toContain('kind')

    // 3) renderer 读的是 ok / aborted 两个判别字段
    expect(rendererSrc).toContain('result.ok')
    expect(rendererSrc).toContain('result.aborted')
  })

  it('CV-I20 mock 形状退回 boolean 时，渲染层分支必须判成失败（不能假绿）', () => {
    // 老契约返回 boolean。若 mock 仍按 boolean 造，renderer 读到 result.ok === undefined，
    // 必须落进 disconnected 分支——绝不能被当成成功。
    const legacy = true as unknown as ConnectResult
    expect(resolveConnectOutcome(legacy)).toStrictEqual({ status: 'disconnected', toast: 'none' })
    expect(connectBranch(legacy)).toBe('failed')
  })
})
