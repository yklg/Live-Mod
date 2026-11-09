// 面板宽度/拖拽导体 E2E：宽度算术、可见页宽、导体显隐、LayoutStore 重启恢复。
// 运行：node poc/shell/e2e-panel-resize.mjs（需先构建）
import path from 'node:path'
import { _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
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
  await waitFor(async () => (await debug()).railReady !== false, 15_000, 'shell ready')
  await app.evaluate(({ app: a }) => a.__shellToggle('live'))
  await waitFor(async () => (await debug()).panelOpen, 5000, '面板打开')
  const base = await debug()
  record('R1 默认面板 600', base.panelWidth === 600 && base.railWidth === 600, JSON.stringify(base))
  const pageW = base.pageBounds?.width
  record('R2 overlay 语义 page 宽 1224', pageW === 1224, String(pageW))

  await app.evaluate(({ app: a }) => a.__shellPanelDragBegin(600, 1000))
  record('R3 导体显示', (await debug()).panelDragVisible === true, '')
  await app.evaluate(({ app: a }) => a.__shellPanelResize(800))
  const wide = await debug()
  record('R4 向左拖到 800', wide.panelWidth === 800 && wide.railWidth === 800, JSON.stringify(wide))
  record('R5 拖宽不改 page', wide.pageBounds?.width === pageW, String(wide.pageBounds?.width))

  await app.evaluate(({ app: a }) => a.__shellPanelResize(1200))
  const narrow = await debug()
  record('R6 右拖越过下限钳到 420', narrow.panelWidth === 420, String(narrow.panelWidth))
  await app.evaluate(({ app: a }) => a.__shellPanelResizeEnd())
  record('R7 导体收起', (await debug()).panelDragVisible === false, '')

  await app.evaluate(({ app: a }) => a.__shellPanelDragBegin(420, 1000))
  await app.evaluate(({ app: a }) => a.__shellPanelResize(700))
  await app.evaluate(({ app: a }) => a.__shellPanelResizeEnd())
  const saved = await debug()
  record('R8 持久化前 720', saved.panelWidth === 720, String(saved.panelWidth))
} catch (e) {
  record('E2E 异常', false, e.message)
} finally {
  await app.close().catch(() => {})
}

// 重启恢复：同一 userData，panelOpen/routeId/宽度都应恢复
app = await launch()
try {
  const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
  const restored = await waitFor(
    async () => {
      const d = await debug()
      return d.panelOpen && d.routeId === 'live' ? d : null
    },
    20_000,
    '重启恢复布局',
  )
  record(
    'R9 重启恢复 open/route',
    true,
    JSON.stringify({ open: restored.panelOpen, route: restored.routeId }),
  )
  record(
    'R10 重启恢复宽度 720',
    restored.panelWidth === 720 && restored.railWidth === 720,
    String(restored.panelWidth),
  )
} catch (e) {
  record('重启恢复失败', false, e.message)
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter(r => !r.ok)
console.log(`\n== 面板 E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
