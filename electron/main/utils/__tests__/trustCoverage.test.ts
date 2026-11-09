import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { describe, expect, it, vi } from 'vitest'

// CI 的 Unit Tests workflow 设置 ELECTRON_SKIP_BINARY_DOWNLOAD=1（不下载 Electron 二进制）：
// 此时 `#/utils/ipc` 顶层的 `import { ipcMain } from 'electron'` 会抛
// "Electron failed to install correctly"。本测试只做源码扫描 + 读静态声明表，不需要真实 ipcMain。
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

import { CHANNEL_TRUST } from '#/utils/ipc'

// ===== 授权声明覆盖（W2 · TC-GT1~GT4，源码扫描式契约断言）=====
// 守护不变量：
//   C-GT1 commentBackend 的通道必须在声明表中（漏声明 = 校验根本不执行）
//   C-GT2 所有 typedIpcMainHandle 首参必须是 IPC_CHANNELS 成员（防手写字符串漂移）
//   C-GT3 授权判定只允许一处实现：ipc/** 内不得再出现 sender.getURL（防回到单点手写守卫）
//   C-GT4 声明表的键必须都是真实通道（防拼写错误导致声明形同虚设）
//
// 注意：扫描用 Node fs + 正则，**不走 shell grep**（shim 环境下 `\|` 交替恒 0，会假绿）。

const IPC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ipc')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...walk(full))
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function readIpcSources(): Array<{ file: string; rel: string; text: string }> {
  return walk(IPC_DIR).map(file => ({
    file,
    rel: path.relative(IPC_DIR, file),
    text: fs.readFileSync(file, 'utf8'),
  }))
}

function flattenChannels(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) flattenChannels(v, out)
  }
  return out
}

describe('授权声明覆盖（TC-GT1~GT4）', () => {
  const sources = readIpcSources()

  it('TC-GT1 commentBackend 的每个 IPC 通道都已声明为受限', () => {
    const backendSrc = sources.find(s => s.rel === 'commentBackend.ts')
    expect(backendSrc, 'ipc/commentBackend.ts 必须存在').toBeTruthy()

    // 该文件注册的通道：两种写法都要覆盖（常量引用 / 直接字面量）
    const declared = [
      IPC_CHANNELS.tasks.commentBackend.getState,
      IPC_CHANNELS.tasks.commentBackend.send,
      IPC_CHANNELS.tasks.commentBackend.debugInject,
    ]
    for (const channel of declared) {
      expect(CHANNEL_TRUST[channel], `${channel} 未在 CHANNEL_TRUST 声明`).toBe('business-ui')
    }

    // 反向：该文件里出现的 commentBackend 通道不得多于声明集
    const usedChannels = [
      ...backendSrc!.text.matchAll(/IPC_CHANNELS\.tasks\.commentBackend\.(\w+)/g),
    ]
      .map(m => m[1])
      .filter(name => !['status', 'comment'].includes(name)) // 事件推送通道，非 invoke 入口
    expect(new Set(usedChannels)).toEqual(new Set(['getState', 'send', 'debugInject']))
  })

  it('TC-GT2 所有 typedIpcMainHandle 首参必须是 IPC_CHANNELS 成员（禁手写字符串）', () => {
    const bad: string[] = []
    for (const { rel, text } of sources) {
      for (const m of text.matchAll(/typedIpcMainHandle(?:<[^>]*>)?\(\s*([^,\n]+)/g)) {
        const firstArg = m[1].trim()
        if (!firstArg.startsWith('IPC_CHANNELS.')) {
          bad.push(`${rel}: ${firstArg}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('TC-GT3 授权判定只允许一处实现：ipc/** 不得出现 sender.getURL', () => {
    const hits = sources.filter(s => s.text.includes('sender.getURL')).map(s => s.rel)
    expect(hits).toEqual([])
  })

  it('TC-GT4 声明表的键必须都是真实通道（防拼写错误）', () => {
    const all = new Set(flattenChannels(IPC_CHANNELS))
    const unknownKeys = Object.keys(CHANNEL_TRUST).filter(k => !all.has(k))
    expect(unknownKeys).toEqual([])
  })
})
