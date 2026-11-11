// dock 宽度/拖拽导体 E2E：宽度算术、让出宽度、导体显隐、LayoutStore 重启恢复。
// 运行：先 node node_modules/vite/bin/vite.js build，再 node poc/shell/e2e-panel-resize.mjs
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail = '') => {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const cwd = path.resolve(import.meta.dirname, '../..')
const userData = `/tmp/lm-e2e-resize-${Date.now()}`
const launch = () =>
  electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd,
    env: { ...process.env, LM_SHELL_DEBUG: '1' },
    timeout: 30_000,
  })
const waitFor = async (fn, timeout, label) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(100)
  }
  throw new Error(`等待超时：${label}`)
}

let app = await launch()
try {
  const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
  await waitFor(async () => (await debug()).shellMode === 'entry', 15_000, 'shell ready')
  await app.evaluate(({ app: a }) => a.__shellModeOpenPanel('popup'))
  await waitFor(async () => (await debug()).panelOpen, 5000, 'dock 打开')
  const base = await debug()
  record(
    'R1 默认 dock 360 / rail 360（壳 v3 · Wave 2：图标条已删，rail 宽=面板宽）',
    base.dockWidth === 360 && base.railWidth === 360,
    JSON.stringify({ dock: base.dockWidth, rail: base.railWidth }),
  )
  record(
    'R2 overlay 下 page 满宽 1280（面板浮在右侧不挤占官方页）',
    base.pageBounds?.width === 1280,
    String(base.pageBounds?.width),
  )

  await app.evaluate(({ app: a }) => a.__shellPanelDragBegin(360, 1000))
  record('R3 导体显示', (await debug()).panelDragVisible === true, '')
  await app.evaluate(({ app: a }) => a.__shellPanelResize(900))
  const wide = await debug()
  record(
    'R4 向左拖到 420 上限',
    wide.dockWidth === 420 && wide.railWidth === 420,
    JSON.stringify({ dock: wide.dockWidth, rail: wide.railWidth }),
  )
  record(
    'R5 dock 变宽 page 仍满宽 1280',
    wide.pageBounds?.width === 1280,
    String(wide.pageBounds?.width),
  )

  await app.evaluate(({ app: a }) => a.__shellPanelResize(1200))
  const narrow = await debug()
  record(
    'R6 右拖越过下限钳到 320',
    narrow.dockWidth === 320 && narrow.railWidth === 320,
    String(narrow.dockWidth),
  )
  await app.evaluate(({ app: a }) => a.__shellPanelResizeEnd())
  record('R7 导体收起', (await debug()).panelDragVisible === false, '')

  await app.evaluate(({ app: a }) => a.__shellPanelDragBegin(320, 1000))
  await app.evaluate(({ app: a }) => a.__shellPanelResize(800))
  await app.evaluate(({ app: a }) => a.__shellPanelResizeEnd())
  const saved = await debug()
  record('R8 持久化前 420', saved.dockWidth === 420, String(saved.dockWidth))
} catch (e) {
  record('E2E 异常', false, e.message)
} finally {
  await app.close().catch(() => {})
}

// 重启恢复：同一 userData + autoRestore 记忆 → live 并恢复 dock
fs.writeFileSync(
  path.join(userData, 'shell-entry.json'),
  JSON.stringify({
    version: 1,
    lastPlatform: 'douyin',
    autoRestore: true,
    updatedAt: new Date().toISOString(),
  }),
)
app = await launch()
try {
  const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
  const restored = await waitFor(
    async () => {
      const d = await debug()
      return d.panelOpen && d.routeId === 'popup' ? d : null
    },
    20_000,
    '重启恢复布局',
  )
  record(
    'R9 重启恢复 open/route',
    true,
    JSON.stringify({ open: restored.panelOpen, route: restored.routeId }),
  )
  record('R10 重启恢复 dock 420', restored.dockWidth === 420, String(restored.dockWidth))
  await app.evaluate(({ app: a }) => a.__shellModeSet('live'))
  await sleep(250)
  const live = await debug()
  record(
    'R11 live 后 rail 420 / page 满宽 1280',
    live.railWidth === 420 && live.pageBounds?.width === 1280,
    JSON.stringify({ rail: live.railWidth, page: live.pageBounds }),
  )
} catch (e) {
  record('重启恢复失败', false, e.message)
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter(r => !r.ok)
console.log(`\n== dock E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
