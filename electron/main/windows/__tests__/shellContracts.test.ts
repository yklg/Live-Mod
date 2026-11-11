import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { SHELL_ROUTES } from 'shared/shellRoutes'
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
    // 入口只走 entryCatalog/entrySelect/entrySkip/entryRememberSet（唯一选择写路径在主进程）
    expect(all).toContain('IPC_CHANNELS.shell.entryCatalog')
    expect(all).toContain('IPC_CHANNELS.shell.entrySelect')
    expect(all).toContain('IPC_CHANNELS.shell.entryRememberSet')
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

  it('TC-P7 [单份通知] 连接失败必须推送通知层（壳 v3 · Wave 1：不再有降级回退，故无 warnToast 配对）', () => {
    const conn = readIfExists('electron/main/ipc/connection.ts') ?? ''
    // 收紧而非删除：失败通知只由主进程推一条到壳级通知覆盖层。
    // 旧断言要求 connection.ts 同时发 shell.warnToast —— 那对"降级回退"是必需的，
    // 但降级已整体下线（Wave 1），connection.ts 不再发 warnToast，断言随之改为「不得发」。
    expect(conn, '连接失败必须推送壳级通知覆盖层').toContain('pushNotice')
    expect(conn, '已无降级回退：不得再发 shell.warnToast').not.toContain('shell.warnToast')
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

  it('TC-CQ2 [视觉契约] 共享原语使用 12px 卡片/圆角令牌/13px 正文；旧 16px 口径清零', () => {
    const ledger: Array<[string, string[]]> = [
      [
        'src/components/ui/card.tsx',
        ['rounded-card', 'border-hairline', 'shadow-elevation-1', 'px-3 pt-3 pb-2', 'text-sm'],
      ],
      ['src/components/common/Page.tsx', ['text-[15px]', 'text-xs', 'panelHeader', 'px-3 pb-4']],
      ['src/components/ui/input.tsx', ['h-8', 'rounded-control', 'text-sm']],
      ['src/components/ui/textarea.tsx', ['rounded-control', 'text-sm']],
      [
        'src/components/ui/dialog.tsx',
        ['rounded-card', 'p-4', 'sm:max-w-sm', 'text-[15px]', 'text-xs'],
      ],
      ['src/components/ui/alert-dialog.tsx', ['rounded-card', 'p-4', 'text-left', 'text-xs']],
      ['src/components/common/SettingsLayout.tsx', ['grid-cols-[148px_1fr]', 'gap-4']],
      ['src/components/common/Panel.tsx', ['panel-section', 'rounded-card', 'shadow-elevation-1']],
      ['src/components/ui/button.tsx', ['rounded-control', 'h-[30px]', 'text-xs']],
      ['src/shell/EntrySelector.tsx', ['@max-[760px]/entry:grid-cols-1', 'rounded-card']],
      ['src/index.css', ['--lm-radius-card: 12px', '--text-sm: var(--text-body)']],
    ]
    for (const [rel, needles] of ledger) {
      const src = readIfExists(rel)
      expect(src, `${rel} 必须存在`).not.toBeNull()
      for (const needle of needles) {
        expect(src, `${rel} 缺少「${needle}」——视觉契约被破坏`).toContain(needle)
      }
    }
    const card = readIfExists('src/components/ui/card.tsx') ?? ''
    expect(card, 'Card 必须删除 rounded-xl').not.toContain('rounded-xl')
    expect(card, 'Card 必须删除 shadow-sm').not.toContain('shadow-sm')
    const input = readIfExists('src/components/ui/input.tsx') ?? ''
    expect(input, 'Input 不再保留 md:text-sm 视口断点').not.toContain('md:text-sm')
  })

  it('TC-CQ3 [C5 回退] Auto 页保留经典两列；600 面板内容不足 → 不使用面板两列变体（单列）', () => {
    for (const rel of ['src/pages/AutoMessage/index.tsx', 'src/pages/AutoPopUp/index.tsx']) {
      const src = readIfExists(rel) ?? ''
      expect(src, '经典全宽两列必须保留').toContain('xl:grid-cols-[2fr_1fr]')
      expect(src, '600 面板内两列会溢出（弹窗设置卡/开关压字）→ 禁用面板两列').not.toContain(
        '@max-[900px]/panel:grid-cols',
      )
    }
  })

  it('TC-CQ4 [路由清单] 单一源 8 条（无 AI）；每个路由有唯一 panelTitle；ShellRail 消费同一源', () => {
    expect(SHELL_ROUTES.map(route => route.path).sort()).toEqual(
      [
        '/',
        '/auto-message',
        '/auto-popup',
        '/auto-reply',
        '/auto-reply/settings',
        '/live-interaction',
        '/red-packet',
        '/settings',
      ].sort(),
    )
    const titles = SHELL_ROUTES.map(route => route.panelTitle)
    expect(titles.every(Boolean), '每个路由必须有 panelTitle').toBe(true)
    expect(new Set(titles).size, 'panelTitle 必须唯一').toBe(titles.length)
    const rail = readIfExists('src/shell/ShellRail.tsx') ?? ''
    expect(rail).toContain('SHELL_ROUTES.map')
    expect(rail).toContain('panelTitle')
    expect(rail).toContain('data-testid="panel-title"')
    expect(rail).not.toContain('/ai-chat')
    expect(readIfExists('src/router/index.tsx')).toBeNull()
  })

  it('TC-CQ6 [最小窗/dock 门槛] app.ts minWidth=1024；图标条已删 → 1000/1060；entry 52 顶栏', () => {
    const app = readIfExists('electron/main/app.ts') ?? ''
    expect(app).toContain('minWidth: 1024')
    const layout = readIfExists('electron/main/windows/shellLayout.ts') ?? ''
    expect(layout).toContain('export const DOCK_MIN = 320')
    expect(layout).toContain('export const DOCK_W = 360')
    expect(layout).toContain('export const DOCK_MAX = 420')
    expect(layout).toContain('export const PAGE_MIN = 640')
    // 壳 v3 · Wave 2：图标条删除后 dock 门槛不再扣图标条宽度 → 1000/1060 是 360/420 的边界
    expect(layout).toContain('winW - dockWidth >= PAGE_MIN')
    expect(layout).toContain("mode === 'entry'")
    expect(layout).not.toContain('LEFT_COMPACT_W')
    // 图标条宽度常量整体退场（守卫：写回即红）
    expect(layout).not.toContain('RAIL_W')
  })

  it('TC-CQ7 [工作台退场] workspace/场次域文件与运行时 token 清零；entry 容器与最小树保留', () => {
    for (const rel of [
      'workspace.html',
      'src/shell/WorkspaceRoot.tsx',
      'src/shell/workspace.tsx',
      'src/shell/workspace.css',
      'electron/main/windows/workspaceMode.ts',
      'electron/main/windows/workspaceStartup.ts',
      'electron/main/ipc/workspace.ts',
      'electron/main/services/LiveHistoryStore.ts',
      'electron/main/services/LiveSessionRecorder.ts',
      'shared/liveHistory.ts',
      'src/hooks/useLiveHistory.ts',
    ]) {
      expect(readIfExists(rel), `${rel} 必须已删除`).toBeNull()
    }
    const entryHtml = readIfExists('entry.html') ?? ''
    expect(entryHtml, 'entry.html 必须声明容器').toContain('@container/entry')
    const selector = readIfExists('src/shell/EntrySelector.tsx') ?? ''
    expect(selector).toContain('@max-[760px]/entry:grid-cols-1')
    const vite = readIfExists('vite.config.ts') ?? ''
    expect(vite).toContain("entry: path.join(__dirname, 'entry.html')")
    expect(vite).not.toContain("workspace: path.join(__dirname, 'workspace.html')")
    const app = readIfExists('electron/main/app.ts') ?? ''
    expect(app).toContain("'entry.html'")
    expect(app).not.toContain('workspace.html')
  })

  it('TC-CQ5 [经典树退场] 经典入口、App、router 已删除', () => {
    expect(readIfExists('index.html')).toBeNull()
    expect(readIfExists('src/App.tsx')).toBeNull()
    expect(readIfExists('src/router/index.tsx')).toBeNull()
  })
})
