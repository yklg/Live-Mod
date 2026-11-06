import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { describe, expect, it } from 'vitest'

// ===== 壳契约扫描断言（guangquan-shell-ui-parity v3 · A1/P3-10）=====
// 范式沿用 storage TC-03「源码扫描式契约断言」：不依赖运行时 Electron，直接扫源码/类型表。
// TC-P4：IPC_CHANNELS.shell 全部通道必须注册进 shared/electron-api.d.ts 的 IpcChannels（类型即契约）。
// TC-E1/E2：入口隔离——chrome 入口模块图物理不含业务全局监听（A1 多入口预防），
//            rail 入口模块图必须含之（防"两边都没注册"的反向漂移）。

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

function readIfExists(rel: string): string | null {
  const p = path.join(root, rel)
  try {
    return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf-8') : null
  } catch {
    return null
  }
}

// 剥离注释后再做符号扫描：注释里的"禁止出现 X"说明文字不应触发禁令断言
// （块注释整体删除；行注释仅删 行首/空白后 的 //…，避免误伤 https://）
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

// 沿 import 图 BFS 收集模块源码（解析 '@/x'、'shared/x'、相对路径；含 .ts/.tsx/index 扩展名；目录跳过）
function existsFile(rel: string): boolean {
  try {
    return fs.statSync(path.join(root, rel)).isFile()
  } catch {
    return false
  }
}

function collectModuleGraph(entryRel: string): { files: string[]; texts: string[] } | null {
  const seen = new Set<string>()
  const texts: string[] = []
  const queue = [entryRel]
  while (queue.length) {
    const shifted = queue.shift()
    if (shifted === undefined) break
    const rel = path.normalize(shifted)
    if (seen.has(rel)) continue
    const src = readIfExists(rel)
    if (src === null) return null // 图中任一文件缺失 → 契约未成立（红灯）
    seen.add(rel)
    texts.push(src)
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      let next: string | null = null
      if (spec.startsWith('@/')) next = `src/${spec.slice(2)}`
      else if (spec.startsWith('shared/')) next = spec
      else if (spec.startsWith('#/')) next = `electron/main/${spec.slice(2)}`
      else if (spec.startsWith('.')) next = path.posix.join(path.posix.dirname(rel), spec)
      if (!next) continue
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const cand = next + ext
        if (existsFile(cand)) {
          queue.push(cand)
          break
        }
      }
    }
  }
  return { files: [...seen], texts }
}

// 运行时源码扫描（排除 shared 类型表——d.ts 合法包含全部通道名，不构成运行时监听）
function runtimeTexts(graph: { files: string[]; texts: string[] }): string {
  return graph.files
    .map((f, i) => (f.startsWith('src/') ? stripComments(graph.texts[i]) : ''))
    .join('\n')
}

describe('shell IPC 通道契约（TC-P4）', () => {
  it('TC-P4 [CT-01 同构] IPC_CHANNELS.shell 全部键必须在 IpcChannels 类型表逐键声明', () => {
    const shell = (IPC_CHANNELS as Record<string, unknown>).shell
    expect(shell, 'IPC_CHANNELS.shell 命名空间必须存在').toBeDefined()
    const keys: string[] = []
    const walk = (v: unknown, prefix: string) => {
      if (typeof v === 'string') keys.push(prefix)
      else if (v && typeof v === 'object')
        for (const [k, child] of Object.entries(v)) walk(child, `${prefix ? `${prefix}.` : ''}${k}`)
    }
    walk(shell, '')
    // tab×7 + list/state + window×3 + railToggle/railState + warnToast/uiStatus/resetLoginState(17)
    // + entryCatalog/entrySelect/entryIntent/entrySkip/entryReopen/railReady(6，shell-entry-platform-selector v1)
    // + notify/notice/noticeReady(3，shell-ui-polish v3 通知层)
    expect(keys.length).toBeGreaterThanOrEqual(26)
    const dts = readIfExists('shared/electron-api.d.ts')
    if (!dts) throw new Error('shared/electron-api.d.ts 缺失')
    for (const key of keys) {
      expect(dts, `IPC_CHANNELS.shell.${key} 必须出现在 IpcChannels 类型中`).toContain(
        `IPC_CHANNELS.shell.${key}`,
      )
    }
  })

  it('TC-P5 [v3 配对契约] leaveWarn 旧通道名全仓源码残留 = 0', () => {
    const offenders: string[] = []
    const walkDir = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walkDir(rel)
        // 排除测试文件自身（扫描器代码含旧名关键词，非运行时残留）
        else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
          const text = readIfExists(rel) ?? ''
          if (text.includes('leaveWarn')) offenders.push(rel)
        }
      }
    }
    for (const top of ['electron', 'src', 'shared']) walkDir(top)
    expect(offenders, '旧通道名 leaveWarn 必须清零（写==读同源 warnToast）').toEqual([])
  })

  it('TC-P6 [v3 partition 同源] persist:lm-shell- 字面量仅存在于 shellTabManager 一处真源', () => {
    const hits: string[] = []
    const walkDir = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walkDir(rel)
        else if (/\.ts$/.test(e.name) && !e.name.includes('.test.')) {
          const text = readIfExists(rel) ?? ''
          if (text.includes('persist:lm-shell-')) hits.push(rel)
        }
      }
    }
    walkDir('electron')
    expect(
      hits.sort(),
      'resetLoginState 等消费方必须改引 accountTabPartition/FREE_TAB_PARTITION',
    ).toEqual(['electron/main/windows/shellTabManager.ts'])
  })
})

describe('入口隔离（TC-E1/E2 · A1 多入口物理预防）', () => {
  it('TC-E1 [chrome 最小树] chrome 入口模块图不含业务全局监听与 tasks 事件注册', () => {
    const graph = collectModuleGraph('src/shell/chrome.tsx')
    if (!graph) throw new Error('src/shell/chrome.tsx 及其 import 图必须完整存在')
    const all = runtimeTexts(graph)
    expect(all).not.toContain('useGlobalIpcListener')
    expect(all).not.toContain('IPC_CHANNELS.tasks.')
    expect(all).not.toContain("from '@/App'")
    expect(all).not.toContain('showComment')
  })

  it('TC-E3 [entry 最小树] entry 入口模块图不含业务全局监听与 tasks 事件注册（对标 TC-E1）', () => {
    const graph = collectModuleGraph('src/shell/entry.tsx')
    if (!graph) throw new Error('src/shell/entry.tsx 及其 import 图必须完整存在')
    const all = runtimeTexts(graph)
    expect(all).not.toContain('useGlobalIpcListener')
    expect(all).not.toContain('IPC_CHANNELS.tasks.')
    expect(all).not.toContain("from '@/App'")
    expect(all).not.toContain('showComment')
    // 入口只准用 shell:* 通道（唯一连接通道在 rail，入口禁止直连 connect）
    expect(all).not.toContain('liveControl.connect')
  })

  it('TC-E4 [notice 最小树] notice 入口模块图不含业务监听/tasks；只消费 shell:* 通道', () => {
    const graph = collectModuleGraph('src/shell/notice.tsx')
    if (!graph) throw new Error('src/shell/notice.tsx 及其 import 图必须完整存在')
    const all = runtimeTexts(graph)
    expect(all).not.toContain('useGlobalIpcListener')
    expect(all).not.toContain('IPC_CHANNELS.tasks.')
    expect(all).not.toContain("from '@/App'")
    // 通知层只消费 shell:notice / shell:noticeReady（不得直连业务通道）
    expect(all).toContain('IPC_CHANNELS.shell.notice')
    expect(all).toContain('IPC_CHANNELS.shell.noticeReady')
  })

  it('TC-P7 [warnToast 配对] 连接降级同时具备 fork 契约通道与通知层推送（防只改一半）', () => {
    const conn = readIfExists('electron/main/ipc/connection.ts') ?? ''
    expect(conn, '必须保留 shell:warnToast（开源 fork 监听契约）').toContain('shell.warnToast')
    expect(conn, '必须同时推送壳级通知覆盖层').toContain('pushNotice')
  })

  it('TC-E2 [rail 完整树·反向断言] rail 入口模块图必须含 useGlobalIpcListener（防两边都没注册）', () => {
    const graph = collectModuleGraph('src/shell/rail.tsx')
    if (!graph) throw new Error('src/shell/rail.tsx 及其 import 图必须完整存在')
    const all = runtimeTexts(graph)
    expect(all).toContain('useGlobalIpcListener')
  })
})

describe('面板密度/容器查询契约（计划 v3 · TC-CQ1~5）', () => {
  it('TC-CQ1 [容器根] rail.html 声明 @container/panel + 高度保障 + 仅面板入口', () => {
    const railHtml = readIfExists('rail.html') ?? ''
    expect(railHtml, 'rail.html 必须有面板容器类').toContain('@container/panel')
    expect(railHtml, 'body 需标记 data-shell-panel（调试/选择器契约）').toContain(
      'data-shell-panel',
    )
    expect(railHtml, '容器根需 height:100% 保障 fixed/Portal 包含块=视口').toContain('height: 100%')
  })

  it('TC-CQ2 [只加不删] 共享组件保留既有视口类，同时新增 @xl/panel 容器变体', () => {
    const ledger: Array<[string, string[]]> = [
      ['src/components/ui/card.tsx', ['p-6', '@xl/panel:p-4', 'text-sm', '@xl/panel:text-xs']],
      [
        'src/components/common/Page.tsx',
        ['px-6 pb-4 pt-5', '@xl/panel:px-4', 'text-xl', '@xl/panel:text-base'],
      ],
      ['src/components/ui/input.tsx', ['md:text-sm', '@xl/panel:text-sm']],
      ['src/components/ui/textarea.tsx', ['md:text-sm', '@xl/panel:text-sm']],
      [
        'src/components/ui/dialog.tsx',
        ['sm:max-w-lg', '@xl/panel:max-w-lg', 'sm:flex-row', '@xl/panel:flex-row'],
      ],
      ['src/components/ui/alert-dialog.tsx', ['sm:text-left', '@xl/panel:text-left']],
      [
        'src/components/common/SettingsLayout.tsx',
        ['grid-cols-[172px_1fr]', '@xl/panel:grid-cols-[148px_1fr]'],
      ],
      ['src/components/ai-chat/APIKeyDialog.tsx', ['sm:max-w-[425px]', '@xl/panel:max-w-[425px]']],
    ]
    for (const [rel, needles] of ledger) {
      const src = readIfExists(rel)
      expect(src, `${rel} 必须存在`).not.toBeNull()
      for (const needle of needles) {
        expect(src, `${rel} 缺少「${needle}」——只加不删契约被破坏`).toContain(needle)
      }
    }
  })

  it('TC-CQ3 [两列] AutoMessage/AutoPopUp 同时保留 xl: 与 @xl/panel: 网格变体', () => {
    for (const rel of ['src/pages/AutoMessage/index.tsx', 'src/pages/AutoPopUp/index.tsx']) {
      const src = readIfExists(rel) ?? ''
      expect(src).toContain('xl:grid-cols-[2fr_1fr]')
      expect(src).toContain('@xl/panel:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')
    }
  })

  it('TC-CQ4 [路由清单] ShellRail 路由 = 计划 §3 的 8 条（含自动回复设置）', () => {
    const src = readIfExists('src/shell/ShellRail.tsx') ?? ''
    const routes = [...src.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]).sort()
    expect(routes).toEqual(
      [
        '/',
        '/ai-chat',
        '/auto-message',
        '/auto-popup',
        '/auto-reply',
        '/auto-reply/settings',
        '/red-packet',
        '/settings',
      ].sort(),
    )
  })

  it('TC-CQ6 [最小窗/死分支] app.ts minWidth=1024 且 > DEGRADE_W（面板降级分支常规不可达）', () => {
    const app = readIfExists('electron/main/app.ts') ?? ''
    expect(app).toContain('minWidth: 1024')
    const layout = readIfExists('electron/main/windows/shellLayout.ts') ?? ''
    expect(layout).toContain('export const DEGRADE_W = PANEL_W + RAIL_W')
  })

  it('TC-CQ5 [经典隔离] 经典入口不声明面板容器（容器变体结构性不生效）', () => {
    const indexHtml = readIfExists('index.html') ?? ''
    const app = readIfExists('src/App.tsx') ?? ''
    expect(indexHtml).not.toContain('@container/panel')
    expect(app).not.toContain('@container/panel')
  })
})
