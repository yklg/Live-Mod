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
  // rail 是菜单宿主：菜单项选中链路必须在真实 rail 视图上验证，而不是只测主进程状态机。
  const rail = await pageBy('rail.html')
  await rail.waitForLoadState().catch(() => {})
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

  // ===== 菜单契约（P0）：选中 / 内部不误收起 / ESC / 帮助外链 =====
  const openMenu = async () => {
    // 前置清理：上一条用例失败时菜单可能仍开着，避免 toggle 语义把「打开」变成「关闭」。
    if ((await debug()).menuOpen) {
      await app.evaluate(({ app: a }) => a.__shellToggle(null))
      await waitFor(async () => (await debug()).menuOpen === false, 3000, '清理旧菜单')
    }
    await chrome.click('text=展开 Live Mod')
    await waitFor(async () => (await debug()).menuOpen === true, 5000, '菜单打开')
    await sleep(150)
  }
  const closeMenuByEscOnRail = async () => {
    await rail.locator('body').press('Escape')
    await waitFor(async () => (await debug()).menuOpen === false, 5000, 'ESC 收起')
  }

  // T14：6 个路由项逐个可选中（本次「点击 tab 无反应」回归的定点用例）
  const routeCases = [
    ['live', '直播控制台'],
    ['popup', '自动弹窗'],
    ['message', '自动发言'],
    ['reply', '自动回复'],
    ['interaction', '直播互动'],
    ['settings', '应用设置'],
  ]
  for (const [routeId, title] of routeCases) {
    try {
      await openMenu()
      await rail.locator(`[data-testid="rail-menu-item-${routeId}"]`).click({ timeout: 4000 })
      const selected = await waitFor(
        async () => {
          const d = await debug()
          return !d.menuOpen && d.panelOpen && d.routeId === routeId ? d : null
        },
        5000,
        `选中 ${routeId}`,
      )
      await sleep(250)
      const panelTitle = (await rail.locator('[data-testid="panel-title"]').textContent())?.trim()
      record(
        `T14 菜单项 ${routeId}`,
        panelTitle === title,
        `route=${selected.routeId} title=${panelTitle}`,
      )
    } catch (e) {
      record(`T14 菜单项 ${routeId}`, false, String(e.message ?? e))
      try {
        await app.evaluate(({ app: a }) => a.__shellToggle(null))
      } catch {}
    }
  }

  // T15：点菜单内部（宿主 padding）不得误收起（outside-click 的双向断言）
  try {
    await openMenu()
    await rail.locator('[data-testid="shell-menu-host"]').click({ position: { x: 2, y: 2 } })
    await sleep(300)
    record('T15 菜单内部点击不误收起', (await debug()).menuOpen === true, '')
    await closeMenuByEscOnRail()
  } catch (e) {
    record('T15 菜单内部点击不误收起', false, String(e.message ?? e))
  }

  // T16：ESC 从 rail 收起
  try {
    await openMenu()
    await closeMenuByEscOnRail()
    record('T16 ESC 从 rail 收起菜单', true, '')
  } catch (e) {
    record('T16 ESC 从 rail 收起菜单', false, String(e.message ?? e))
  }

  // T17：ESC 从官方页收起（页面 before-input-event 兜底）
  // 用主进程 sendInputEvent 而不是 CDP keyboard：后者不触发 Electron before-input-event（实测）。
  try {
    await openMenu()
    await app.evaluate(({ app: a, webContents }) => {
      const d = a.__shellDebug()
      const active = d.tabs.find(t => t.active)
      if (!active) throw new Error('无 active tab')
      const wc = webContents.fromId(active.wcId)
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    })
    await waitFor(async () => (await debug()).menuOpen === false, 5000, '页面 ESC 收起')
    record('T17 ESC 从页面收起菜单', true, '')
  } catch (e) {
    record('T17 ESC 从页面收起菜单', false, String(e.message ?? e))
    try {
      await app.evaluate(({ app: a }) => a.__shellToggle(null))
    } catch {}
  }

  // T18：帮助外链打开并收起菜单（monkey-patch openExternal，避免真实拉起浏览器）
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__lmExternalUrl = null
      shell.openExternal = async url => {
        globalThis.__lmExternalUrl = url
      }
    })
    await openMenu()
    await rail.locator('[data-testid="rail-menu-item-help"]').click({ timeout: 4000 })
    await waitFor(async () => (await debug()).menuOpen === false, 5000, '帮助项收起菜单')
    const url = await app.evaluate(() => globalThis.__lmExternalUrl)
    record(
      'T18 帮助外链打开并收起菜单',
      typeof url === 'string' && url.includes('github.com'),
      String(url),
    )
  } catch (e) {
    record('T18 帮助外链打开并收起菜单', false, String(e.message ?? e))
  }

  // ===== 账号固定卡（P1）：第一张 / 不可关闭 / Cmd+W no-op / Cmd+1 =====
  try {
    const accountTab = await app.evaluate(({ app: a }) =>
      a.__shellTabCreate({ accountId: 'e2e-acc' }),
    )
    await waitFor(
      async () => (await debug()).tabs.some(t => t.id === accountTab && t.active),
      5000,
      '账号卡激活',
    )
    await sleep(250)
    const firstTabId = await chrome.locator('[data-tab-id]').first().getAttribute('data-tab-id')
    const closeButtons = await chrome
      .locator(`[data-tab-id="${accountTab}"]`)
      .locator('[aria-label="关闭标签页"]')
      .count()
    record(
      'T19 账号卡固定第一且无关闭按钮',
      Number(firstTabId) === accountTab && closeButtons === 0,
      `first=${firstTabId} close=${closeButtons}`,
    )
    await focusChrome()
    await key('W', ['meta'])
    await sleep(300)
    record(
      'T20 Cmd+W 对账号卡 no-op',
      (await debug()).tabs.some(t => t.id === accountTab),
      '',
    )
    await key('1', ['meta'])
    await waitFor(
      async () => (await debug()).tabs.find(t => t.id === accountTab)?.active === true,
      5000,
      'Cmd+1 激活账号卡',
    )
    record('T21 Cmd+1 激活账号卡', true, '')
  } catch (e) {
    record('T19-T21 账号卡契约', false, String(e.message ?? e))
  }

  // T22：关闭其他必须排除账号卡
  try {
    await tabCreate({ url: 'about:blank#free-a' })
    await tabCreate({ url: 'about:blank#free-b' })
    await waitFor(
      async () => (await debug()).tabs.filter(t => t.kind !== 'account').length >= 2,
      5000,
      'free 卡准备',
    )
    const accountId = (await debug()).tabs.find(t => t.kind === 'account')?.id
    const freeIds = (await debug()).tabs.filter(t => t.kind !== 'account').map(t => t.id)
    const targetFree = freeIds.at(-1)
    await chrome.locator(`[data-tab-id="${targetFree}"]`).click()
    await chrome.locator(`[data-tab-id="${targetFree}"]`).click({ button: 'right' })
    await chrome.getByText('关闭其他标签页').click()
    await waitFor(async () => (await debug()).tabs.length === 2, 5000, '关闭其他')
    const remain = await debug()
    record(
      'T22 关闭其他排除账号卡',
      remain.tabs.some(t => t.id === accountId) &&
        remain.tabs.filter(t => t.kind !== 'account').length === 1,
      JSON.stringify(remain.tabs.map(t => t.kind)),
    )
  } catch (e) {
    record('T22 关闭其他排除账号卡', false, String(e.message ?? e))
  }

  // T23：菜单关闭后恢复打开前的面板 route
  try {
    await app.evaluate(({ app: a }) => a.__shellToggle('popup'))
    await waitFor(
      async () => {
        const d = await debug()
        return d.panelOpen && d.routeId === 'popup' ? d : null
      },
      5000,
      '面板 popup',
    )
    await openMenu()
    await chrome.click('text=展开 Live Mod') // 菜单开着时再点按钮 = 关闭并恢复
    await waitFor(
      async () => {
        const d = await debug()
        return !d.menuOpen && d.panelOpen && d.routeId === 'popup' ? d : null
      },
      5000,
      '恢复 popup',
    )
    record('T23 关闭菜单恢复原面板 route', true, '')
  } catch (e) {
    record('T23 关闭菜单恢复原面板 route', false, String(e.message ?? e))
  }

  // T24：菜单打开时窗口 resize，rail bounds 跟随且菜单不丢
  try {
    await openMenu()
    await app.evaluate(({ BrowserWindow }) => {
      const win =
        BrowserWindow.getAllWindows().find(w => w.contentView.children.length > 0) ??
        BrowserWindow.getAllWindows()[0]
      win.setSize(1024, 800)
    })
    await sleep(450)
    const d = await debug()
    record(
      'T24 菜单打开时 resize 跟随',
      d.menuOpen && d.windowWidth === 1024 && d.railWidth === 232,
      JSON.stringify({ menu: d.menuOpen, window: d.windowWidth, rail: d.railWidth }),
    )
    await app.evaluate(({ BrowserWindow }) => {
      const win =
        BrowserWindow.getAllWindows().find(w => w.contentView.children.length > 0) ??
        BrowserWindow.getAllWindows()[0]
      win.setSize(1280, 800)
    })
    await sleep(300)
    await closeMenuByEscOnRail()
  } catch (e) {
    record('T24 菜单打开时 resize 跟随', false, String(e.message ?? e))
  }

  // T25：键盘 Tab + Enter 选中菜单项
  try {
    await openMenu()
    await app.evaluate(({ app: a }) => a.__shellFocusView('rail'))
    await sleep(200)
    // 关键回归点：焦点进入菜单宿主不得收起菜单（否则后续 click/Enter 永远收不到）
    record('T25a 聚焦 rail 不收起菜单', (await debug()).menuOpen === true, '')
    let focusedItem = null
    for (let i = 0; i < 4; i++) {
      await rail.keyboard.press('Tab')
      focusedItem = await rail.evaluate(
        () => document.activeElement?.getAttribute?.('data-testid') ?? null,
      )
      if (focusedItem?.startsWith('rail-menu-item-')) break
    }
    if (!focusedItem?.startsWith('rail-menu-item-')) throw new Error('未聚焦到菜单项')
    await rail.keyboard.press('Enter')
    await waitFor(
      async () => {
        const d = await debug()
        return !d.menuOpen && d.panelOpen ? d : null
      },
      5000,
      '键盘选中',
    )
    record('T25 键盘 Tab+Enter 选中菜单项', true, focusedItem)
  } catch (e) {
    record('T25 键盘 Tab+Enter 选中菜单项', false, String(e.message ?? e))
  }
} catch (e) {
  record('E2E 异常', false, e.message)
} finally {
  await app.close().catch(() => {})
}
const failed = results.filter(r => !r.ok)
console.log(`\n== 标签 E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
