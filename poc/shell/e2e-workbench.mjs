// 第二期工作台窗口级 E2E：启动首页、账号、模式切换、dock、可见标签、1024 overlay。
// 运行：先 node node_modules/vite/bin/vite.js build，再 node poc/shell/e2e-workbench.mjs
import path from 'node:path'
import { _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail = '') => {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const app = await electron.launch({
  args: ['.', `--user-data-dir=/tmp/lm-e2e-workbench-${Date.now()}`],
  cwd: path.resolve(import.meta.dirname, '../..'),
  env: { ...process.env, LM_SHELL_DEBUG: '1' },
  timeout: 30_000,
})
const dbg = () => app.evaluate(({ app: a }) => a.__shellDebug())
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
const pageBy = needle =>
  waitFor(() => app.windows().find(w => w.url().includes(needle)), 15_000, `页面 ${needle}`)
const setMode = mode => app.evaluate(({ app: a }, m) => a.__shellWorkspaceModeSet(m), mode)

try {
  const workspace = await pageBy('workspace.html')
  const chrome = await pageBy('chrome.html')
  await chrome.waitForLoadState().catch(() => {})
  await waitFor(async () => (await dbg()).workspaceMode === 'workbench', 10_000, '工作台就绪')

  const home = await dbg()
  record(
    'W1 启动首页',
    home.workspaceMode === 'workbench' && home.entryVisible === false,
    JSON.stringify({ mode: home.workspaceMode, entry: home.entryVisible }),
  )
  record(
    'W2 三行几何（工作台 52）',
    home.chromeHeight === 52 && home.workspaceBounds.width === 1224 && home.pageBounds === null,
    JSON.stringify({ chrome: home.chromeHeight, ws: home.workspaceBounds, page: home.pageBounds }),
  )
  record(
    'W3 平台目录 3 条',
    (await workspace.locator('[data-testid="platform-grid"] > button').count()) === 3,
    '',
  )
  record('W4 默认账号渲染', (await workspace.locator('body').innerText()).includes('默认账号'), '')
  await workspace.getByRole('button', { name: /打开中控台/ }).click()
  await sleep(200)
  record(
    'W4b 空场次点中控给提示且不进 live',
    (await workspace.locator('.ws-error').count()) === 1 &&
      (await dbg()).workspaceMode === 'workbench',
    await workspace.locator('.ws-error').innerText(),
  )

  const added = await workspace.evaluate(() => window.ipcRenderer.invoke('account:add', 'E2E 账号'))
  await sleep(300)
  record(
    'W5 账号新增走主进程',
    added.ok === true && (await workspace.locator('body').innerText()).includes('E2E 账号'),
    '',
  )
  const testId = added.snapshot.accounts.find(a => a.name === 'E2E 账号').id
  const switched = await workspace.evaluate(
    id => window.ipcRenderer.invoke('account:switch', { account: { id, name: 'E2E 账号' } }),
    testId,
  )
  await sleep(250)
  record(
    'W6 账号切换',
    switched.ok === true &&
      (await workspace.evaluate(() => window.ipcRenderer.invoke('account:get')))
        .currentAccountId === testId,
    '',
  )

  await setMode('live')
  await sleep(250)
  const live = await dbg()
  record(
    'W7 live 模式几何',
    live.workspaceMode === 'live' &&
      live.chromeHeight === 88 &&
      live.workspaceBounds.width === 56 &&
      live.pageBounds?.x === 56,
    JSON.stringify(live.pageBounds),
  )

  await app.evaluate(({ app: a }) => a.__shellWorkspaceOpenPanel('popup'))
  await sleep(250)
  const dock = await dbg()
  record(
    'W8 dock 360 让出宽度',
    dock.dockWidth === 360 && dock.railWidth === 416 && dock.pageBounds?.width === 808,
    JSON.stringify({ dock: dock.dockWidth, rail: dock.railWidth, page: dock.pageBounds }),
  )

  await app.evaluate(({ app: a }) => a.__shellFocusView('chrome'))
  await app.evaluate(({ app: a }) => a.__shellSendInputEvent('W', ['meta']))
  await sleep(200)
  record('W9 live 下 Cmd+W 不关中控', (await dbg()).panelOpen === true, '')

  await app.evaluate(({ app: a }, id) => a.__shellTabCreate({ accountId: id }), testId)
  await sleep(200)
  await setMode('browse')
  await sleep(250)
  const browse = await dbg()
  const visibleIds = await chrome
    .locator('[data-tab-id]')
    .evaluateAll(els => els.map(e => Number(e.dataset.tabId)))
  const accountTabs = browse.tabs.filter(t => t.kind === 'account').map(t => t.id)
  record(
    'W10 标签行只显示自由标签',
    browse.workspaceMode === 'browse' &&
      browse.chromeHeight === 124 &&
      accountTabs.every(id => !visibleIds.includes(id)),
    JSON.stringify({ visibleIds, accountTabs }),
  )

  await app.evaluate(({ app: a }) => a.__shellFocusView('chrome'))
  await app.evaluate(({ app: a }) => a.__shellSendInputEvent('T', ['meta']))
  await sleep(250)
  record(
    'W11 Cmd+T 新建自由标签',
    (await dbg()).tabs.filter(t => t.kind !== 'account').length >= 2,
    '',
  )

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.contentView.children.length > 0)
    w.setSize(1024, 720)
  })
  await sleep(400)
  const narrow = await dbg()
  record(
    'W12 1024 overlay 保 page',
    narrow.pageBounds?.width === 912 && narrow.railWidth === 416,
    JSON.stringify({ page: narrow.pageBounds, rail: narrow.railWidth }),
  )

  await workspace.evaluate(id => window.ipcRenderer.invoke('account:remove', id), testId)
  await sleep(200)
  record(
    'W13 删除账号回默认',
    (await workspace.evaluate(() => window.ipcRenderer.invoke('account:get'))).currentAccountId ===
      'default',
    '',
  )
} catch (e) {
  record('E2E 异常', false, e.message)
} finally {
  await app.close().catch(() => {})
  try {
    app.process().kill('SIGKILL')
  } catch {}
}
const failed = results.filter(r => !r.ok)
console.log(`\n== 工作台 E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
