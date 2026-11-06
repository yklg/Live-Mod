import { describe, expect, it, vi } from 'vitest'
import { resolveCdpEndpoint } from '#/driver/cdpEndpoint'

// ===== CDP endpoint 解析契约（外部经验 M7：connectOverCDP 失败多为 endpoint shape/未就绪）=====
// 守护不变量：
//   I4 任何输入异常都归约为 { ok:false, reason }（F3 降级信号），禁止裸抛
//   I5 dev 显式端口优先；生产只信 DevToolsActivePort 文件
// 依赖注入 readPortFile，不触真实 fs。

const ctx = (opts: { isDev?: boolean; envPort?: string; file?: string | null }) => ({
  isDev: opts.isDev ?? false,
  env: opts.envPort ? { LM_CDP_PORT: opts.envPort } : {},
  readPortFile: vi.fn(() => opts.file ?? null),
})

describe('resolveCdpEndpoint（TC-U7 ~ TC-U8）', () => {
  it('TC-U7 [正常两行] 端口+ws 路径解析成功', () => {
    const r = resolveCdpEndpoint(ctx({ file: '57571\n/devtools/browser/93dc-abc\n' }))
    expect(r).toMatchObject({ ok: true, port: 57571 })
    expect(r.wsEndpoint).toMatch(/^http:\/\/127\.0\.0\.1:57571/)
  })

  // 壳内登录 v3 实证（缺陷 C 回归防线）：connectOverCDP 必须收到纯 HTTP 基址——
  // 端口文件第 2 行 /devtools/browser/<id> 若被拼进 endpoint，Chromium http handler 会请求
  // 未知路径 <id>/json/version/ 导致 connect-failed。此处用精确相等锁死形状（前缀正则挡不住）。
  it('TC-U7c [精确形状] 端口文件分支 wsEndpoint 恰为 http 基址，不含 /devtools 路径', () => {
    const r = resolveCdpEndpoint(ctx({ file: '57571\n/devtools/browser/93dc-abc\n' }))
    expect(r.wsEndpoint).toBe('http://127.0.0.1:57571')
    expect(r.wsEndpoint).not.toContain('/devtools')
  })

  it('TC-U7d [精确形状] dev 显式端口分支同款纯基址', () => {
    const r = resolveCdpEndpoint(ctx({ isDev: true, envPort: '9222', file: null }))
    expect(r.wsEndpoint).toBe('http://127.0.0.1:9222')
  })

  it('TC-U7b [dev 固定端口] LM_CDP_PORT 优先于文件', () => {
    const r = resolveCdpEndpoint(
      ctx({ isDev: true, envPort: '9222', file: '57571\n/devtools/browser/x' }),
    )
    expect(r).toMatchObject({ ok: true, port: 9222 })
  })

  it('TC-U8 [文件缺失 → F3]', () => {
    const r = resolveCdpEndpoint(ctx({ file: null }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('port-file-missing')
  })

  it('TC-U8b [单行残缺 → F3]', () => {
    const r = resolveCdpEndpoint(ctx({ file: '57571' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('port-file-malformed')
  })

  it('TC-U8c [首行非数字 → F3]', () => {
    const r = resolveCdpEndpoint(ctx({ file: 'abc\n/devtools/browser/x' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('port-file-malformed')
  })

  it('TC-U8d [端口越界 → F3]', () => {
    const r = resolveCdpEndpoint(ctx({ file: '99999999\n/devtools/browser/x' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('port-invalid')
  })

  it('TC-U8e [读取抛异常也不裸抛]', () => {
    const r = resolveCdpEndpoint({
      isDev: false,
      env: {},
      readPortFile: () => {
        throw new Error('EACCES')
      },
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('port-file-unreadable')
  })

  // P1 缺陷回归：harness/调试脚本约定 LM_CDP_PORT=0 表示「未指定 → 随机端口」，
  // 真实端口由 Chromium 写入 DevToolsActivePort；若把 '0' 判非法，attach 会静默降级 launch。
  it("TC-U8f [LM_CDP_PORT='0' 视为未指定] 走端口文件分支读随机端口", () => {
    const r = resolveCdpEndpoint(ctx({ envPort: '0', file: '57571\n/devtools/browser/93dc-abc\n' }))
    expect(r).toMatchObject({ ok: true, port: 57571 })
    expect(r.wsEndpoint).toBe('http://127.0.0.1:57571')
  })

  it("TC-U8g [LM_CDP_PORT='0' 且无端口文件] 归约为 port-file-missing 而非 port-invalid", () => {
    const r = resolveCdpEndpoint(ctx({ envPort: '0', file: null }))
    expect(r).toMatchObject({ ok: false, reason: 'port-file-missing' })
  })

  it("TC-U8h [其它非法值仍归约 port-invalid] 只有 '0' 被特判为未指定", () => {
    expect(resolveCdpEndpoint(ctx({ envPort: 'abc', file: null }))).toMatchObject({
      ok: false,
      reason: 'port-invalid',
    })
    expect(resolveCdpEndpoint(ctx({ envPort: '99999999', file: null }))).toMatchObject({
      ok: false,
      reason: 'port-invalid',
    })
  })
})
