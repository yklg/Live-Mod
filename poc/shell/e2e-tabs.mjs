// 标签窗口级 E2E（LM_SHELL_DEBUG=1 调试契约）：创建/拖拽/右键/中键/关闭/重开。
// 运行：先 node node_modules/vite/bin/vite.js build，再 node poc/shell/e2e-tabs.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const profile = `/tmp/lm-e2e-tabs-${Date.now()}`
const app = await electron.launch({
  args: ['.', `--user-data-dir=${profile}`],
  cwd: path.resolve(import.meta.dirname, '../..'),
  env: { ...process.env, LM_SHELL_DEBUG: '1' },
  timeout: 30_000,
})
const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
const tabCreate = opts => app.evaluate(({ app: a }, o) => a.__shellTabCreate(o), opts)
const tabReopen = () => app.evaluate(({ app: a }) => a.__shellTabReopen())
const focusChrome = () => app.evaluate(({ app: a }) => a.__shellFocusView('chrome'))
const key = (code, mods) =>
  app.evaluate(({ app: a }, [c, m]) => a.__shellSendInputEvent(c, m), [code, mods])
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

try {
  const chrome = await pageBy('chrome.html')
  await chrome.waitForLoadState().catch(() => {})
  // entry 首屏 → 自由浏览；标签行只在 browse 出现
  await app.evaluate(({ app: a }) => a.__shellModeSet('browse'))
  await waitFor(async () => (await debug()).shellMode === 'browse', 5000, 'browse 模式')
  await chrome.waitForSelector('button[aria-label="新标签页"]', { timeout: 5000 })
  await sleep(300)
  const initial = await debug()
  record('T1 初始 1 个 Tab', initial.tabs.length === 1, JSON.stringify(initial.tabs))

  await chrome.click('button[aria-label="新标签页"]')
  await waitFor(async () => (await debug()).tabs.length === 2, 5000, '点击 + 新建')
  record('T2 点击 + 新建 Tab', true, '')

  await focusChrome()
  await key('T', ['meta'])
  await waitFor(async () => (await debug()).tabs.length === 3, 5000, 'Meta+T')
  record('T3 Meta+T 新建', true, '')

  await key('1', ['meta'])
  await waitFor(async () => (await debug()).tabs[0]?.active, 5000, 'Meta+1')
  record('T4 Meta+1 激活首个', true, '')

  await key('9', ['meta'])
  await waitFor(async () => (await debug()).tabs.at(-1)?.active, 5000, 'Meta+9')
  record('T5 Meta+9 激活末个', true, '')

  // 拖拽排序：把第一个 tab 拖到最右
  const beforeOrder = (await debug()).tabs.map(t => t.id).join(',')
  const tabs = chrome.locator('[data-tab-id]')
  const first = await tabs.first().boundingBox()
  if (first) {
    await chrome.mouse.move(first.x + 20, first.y + 12)
    await chrome.mouse.down()
    await chrome.mouse.move(first.x + 500, first.y + 12, { steps: 10 })
    await chrome.mouse.up()
  }
  const moved = await debug()
  const afterOrder = moved.tabs.map(t => t.id).join(',')
  record('T6 拖拽排序', afterOrder !== beforeOrder, `${beforeOrder} -> ${afterOrder}`)

  // 右键菜单：关闭其他
  await chrome.locator('[data-tab-id]').nth(1).click({ button: 'right' })
  await chrome.getByText('关闭其他标签页').click()
  await waitFor(async () => (await debug()).tabs.length === 1, 5000, '关闭其他')
  record('T7 右键关闭其他', true, '')

  // 中键关闭
  await tabCreate({})
  await waitFor(async () => (await debug()).tabs.length === 2, 5000, '中键前新建')
  const beforeMiddle = (await debug()).tabs.length
  await chrome.locator('[data-tab-id]').first().click({ button: 'middle' })
  await waitFor(async () => (await debug()).tabs.length === beforeMiddle - 1, 5000, '中键关闭')
  record('T8 中键关闭', true, '')

  // 关闭最后一个：不变量重建空白（Meta+W 主进程快捷键）
  await focusChrome()
  await key('W', ['meta'])
  await waitFor(async () => (await debug()).tabs.length === 1, 5000, '末位重建')
  record('T9 Meta+W 关闭末位重建空白', true, '')

  // 重开最近关闭（free Tab）
  const id = await tabCreate({ url: 'about:blank#reopen' })
  await waitFor(async () => (await debug()).tabs.some(t => t.id === id), 5000, '重开前新建')
  await app.evaluate(({ app: a }, tabId) => a.__shellTabClose(tabId), id)
  await sleep(200)
  const reopened = await tabReopen()
  await waitFor(async () => (await debug()).tabs.some(t => t.id === reopened), 5000, '重开')
  record('T10 重开最近关闭', typeof reopened === 'number', String(reopened))

  // 顶栏菜单失焦契约（壳 v3）：点顶栏其它区域 / 页面获焦都应自动收起。
  await chrome.click('text=展开 Live Mod')
  await waitFor(async () => (await debug()).menuOpen === true, 5000, '菜单打开')
  await sleep(150) // 等 chrome 渲染层收到 menuOpen 状态（Pointerdown 监听安装完成）
  record('T11 顶栏菜单打开', true, '')
  await chrome.click('input[placeholder="搜索或输入网址"]')
  await waitFor(async () => (await debug()).menuOpen === false, 5000, '顶栏点击收起')
  record('T12 点顶栏其它区域收起菜单', true, '')
  // about:blank 的 pageView 不出现在 CDP target 列表；建一个真实 data: 页面作为点击目标。
  const clickTab = await tabCreate({ url: 'data:text/html,<h1>click-target</h1>' })
  await waitFor(
    async () => (await debug()).tabs.some(t => t.id === clickTab && t.active),
    5000,
    '点击目标页激活',
  )
  await chrome.click('text=展开 Live Mod')
  await waitFor(async () => (await debug()).menuOpen === true, 5000, '菜单再次打开')
  await sleep(150)
  // 真实鼠标点进页面：WebContentsView 无 DOM 可点，经 CDP 命中页面 target。
  const port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf-8').split('\n')[0].trim()
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  try {
    const pages = cdp.contexts().flatMap(c => c.pages())
    const page = pages.find(p => p.url().startsWith('data:'))
    if (!page) throw new Error('未找到官方页 WebContentsView target')
    await page.mouse.click(40, 40)
  } finally {
    await cdp.close().catch(() => {})
  }
  await waitFor(async () => (await debug()).menuOpen === false, 5000, '点击页面收起')
  record('T13 点击页面收起菜单', true, '')
} catch (e) {
  record('E2E 异常', false, e.message)
} finally {
  await app.close().catch(() => {})
}
const failed = results.filter(r => !r.ok)
console.log(`\n== 标签 E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
