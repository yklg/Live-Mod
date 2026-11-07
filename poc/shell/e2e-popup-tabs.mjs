// 弹窗→新 Tab E2E（fix-shell-popup-navigation-liveend · Phase 2 · v2 焦点契约）
// 前置：node ./node_modules/vite/bin/vite.js build（dist 与源码一致）；本脚本注入 LM_SHELL_UI=1 LM_SHELL_DEBUG=1 启动。
// 场景全部使用本地 HTTP 测试页（绝连真实平台）。断言「浏览器语义 + 焦点契约 + 隐藏页可自动化」：
//   POP1 opener active 时弹窗 → 壳内新 Tab 自动前台、接管键盘焦点；原页内容不变
//   POP2 官方页兜底 `if(!w) location.href=url` → 新 Tab 已承载，当前页兜底跳转被 will-navigate 抑制
//   POP3 自复制弹窗 → deny-selfdup：不开新 Tab、当前页不变
//   POP6 新 Tab 前台后，原中控页（非激活）仍可被自动化操作、页面定时器不被节流（保活不变量）
//   POP7 后台 opener 自发弹窗 → 后台打开、不抢 active/焦点（门控）
//   POP8 登录窗口期 intent-navigate（调试注入）→ 同页折叠，不新 Tab（回归）
//   POP10 日志契约：activate/openerActive 字段与行为一致
// 运行：env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 node poc/shell/e2e-popup-tabs.mjs

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium, _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, intervalMs = 250) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await fn()
    if (last) return last
    await sleep(intervalMs)
  }
  return last
}

const PAGES = {
  '/index.html': `<!doctype html><meta charset="utf-8"><title>E2E HOME</title>
    <button id="btn" onclick="window.__clicks=(window.__clicks||0)+1">click</button>
    <button id="same-path" onclick="window.open('/other.html')">same</button>
    <button id="self-dup" onclick="window.open(location.href)">self</button>
    <button id="fallback" onclick="const w=window.open('/fallback.html'); if(!w){ location.href='/fallback.html' }">fallback</button>
    <input id="inp" />
    <div style="height:2500px;background:linear-gradient(#eee,#999)">spacer</div>
    <button id="deep" onclick="window.__deep=(window.__deep||0)+1">deep</button>
    <script>
      window.__clicks = 0; window.__deep = 0; window.__ticks = 0;
      setInterval(() => { window.__ticks++ }, 200);
    </script>`,
  '/fold.html': `<!doctype html><meta charset="utf-8"><title>E2E FOLD</title>
    <button id="same-path" onclick="window.open('/other.html')">same</button>`,
  '/other.html': `<!doctype html><meta charset="utf-8"><title>E2E OTHER</title><h1>other</h1>`,
  '/other2.html': `<!doctype html><meta charset="utf-8"><title>E2E OTHER2</title><h1>other2</h1>`,
  '/fallback.html': `<!doctype html><meta charset="utf-8"><title>E2E FALLBACK</title><h1>fallback</h1>`,
  '/bg.html': `<!doctype html><meta charset="utf-8"><title>E2E BG</title><h1>bg</h1>`,
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const body = PAGES[url.pathname] ?? PAGES['/index.html']
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function main() {
  const { server, port } = await startServer()
  const base = `http://127.0.0.1:${port}`
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'lm-e2e-popup-'))
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SANDBOX: '1',
    LM_SHELL_UI: '1',
    LM_SHELL_DEBUG: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env,
  })
  const logLines = []
  app.process().stderr?.on('data', d => logLines.push(String(d)))
  app.process().stdout?.on('data', d => logLines.push(String(d)))

  let browser
  try {
    const portFile = `${userDataDir}/DevToolsActivePort`
    const devtoolsPort = await waitFor(() => {
      try {
        const line = readFileSync(portFile, 'utf8').split('\n')[0].trim()
        return line ? Number(line) : null
      } catch {
        return null
      }
    }, 45_000)
    if (!devtoolsPort) throw new Error('DevToolsActivePort 未就绪')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${devtoolsPort}`)
    const allPages = () => browser.contexts().flatMap(c => c.pages())
    const chromePage = await waitFor(
      async () => (await allPages()).find(p => p.url().includes('chrome.html')),
      30_000,
    )
    if (!chromePage) throw new Error('chromeView 未就绪')

    // ===== 调试契约（LM_SHELL_DEBUG=1）：主进程态（含焦点/页签 wc 映射）=====
    const debug = async () =>
      app.evaluate(({ app: a }) => {
        if (!a.__shellDebug) throw new Error('LM_SHELL_DEBUG 契约未注册：app.__shellDebug 缺失')
        return a.__shellDebug()
      })
    await waitFor(async () => {
      try {
        await debug()
        return true
      } catch {
        return false
      }
    }, 20_000)

    const tabsList = () => chromePage.evaluate(() => window.ipcRenderer.invoke('shell:tabsList'))
    const tabState = async () => {
      const state = await tabsList()
      const dbg = await debug()
      const active = state.tabs.find(t => t.id === state.activeId)
      const activeDebug = dbg.tabs.find(t => t.id === state.activeId)
      return {
        tabs: state.tabs,
        activeId: state.activeId,
        activeUrl: active?.url ?? '',
        activeWcId: activeDebug?.wcId ?? null,
        focusedWebContentsId: dbg.focusedWebContentsId ?? null,
        count: state.tabs.length,
      }
    }
    const findPage = async suffix => {
      const start = Date.now()
      while (Date.now() - start < 15_000) {
        const p = (await allPages()).find(pg => pg.url().startsWith(`${base}${suffix}`))
        if (p) return p
        await sleep(200)
      }
      return null
    }

    // 自动化环境窗口可能未获 OS 焦点（此时 webContents.isFocused 全 false）：
    // 先尽力聚焦壳窗口；焦点断言在「焦点可用」时硬断言，不可用时降级为环境警告（契约由单测 TC-T17/T18 覆盖）。
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.show()
        win.focus()
      }
    })
    const focusAvailable = async () => (await debug()).focusedWebContentsId !== null

    // ===== 建测试 Tab（当前 active）=====
    await chromePage.evaluate(
      ({ base }) => window.ipcRenderer.invoke('shell:tabCreate', { url: `${base}/index.html` }),
      { base },
    )
    const testPage = await findPage('/index.html')
    if (!testPage) throw new Error('测试页未打开')
    await testPage.waitForLoadState('domcontentloaded')
    await sleep(400)

    // ===== POP1 opener active → 新 Tab 前台 + 键盘焦点 =====
    const before = await tabState()
    await testPage.evaluate(() => document.querySelector('#same-path')?.click())
    const otherPage = await findPage('/other.html')
    await sleep(1000)
    const afterSame = await tabState()
    const popupWcId = afterSame.activeWcId
    const focusReady = await focusAvailable()
    const popupFocusOk = !focusReady || afterSame.focusedWebContentsId === popupWcId
    record(
      'POP1',
      !!otherPage &&
        afterSame.count === before.count + 1 &&
        afterSame.activeUrl.startsWith(`${base}/other.html`) &&
        popupFocusOk &&
        testPage.url() === `${base}/index.html`,
      `新Tab=${!!otherPage}；Tab数 ${before.count}→${afterSame.count}；active=${afterSame.activeUrl}；` +
        `焦点wc=${afterSame.focusedWebContentsId}/popup=${popupWcId}${focusReady ? '' : '（环境无 OS 焦点：焦点断言由单测覆盖）'}；原页=${testPage.url()}`,
    )

    // ===== POP6 原中控页（隐藏）仍可自动化 + 定时器满速（保活不变量）=====
    const hiddenOk = await (async () => {
      try {
        const tick0 = await testPage.evaluate(() => window.__ticks)
        await testPage.evaluate(() => document.querySelector('#btn')?.click())
        const btn = await testPage.$('#btn')
        await btn.dispatchEvent('click')
        await testPage.locator('#inp').fill('abc', { timeout: 4000 })
        const deep = await testPage.$('#deep')
        await deep.scrollIntoViewIfNeeded({ timeout: 4000 })
        await deep.dispatchEvent('click')
        await sleep(8000)
        const state = await testPage.evaluate(() => ({
          clicks: window.__clicks,
          deep: window.__deep,
          value: document.querySelector('#inp')?.value,
        }))
        const tick1 = await testPage.evaluate(() => window.__ticks)
        return {
          ok:
            state.clicks >= 2 &&
            state.deep >= 1 &&
            state.value === 'abc' &&
            tick1 - tick0 >= 30 &&
            testPage.url() === `${base}/index.html`,
          detail:
            `clicks=${state.clicks} deep=${state.deep} value=${state.value} ticks=${tick1 - tick0}/8s` +
            `（期望≥30，节流会≈8）；url=${testPage.url()}`,
        }
      } catch (e) {
        return { ok: false, detail: `异常：${String(e).split('\n')[0]}` }
      }
    })()
    record('POP6', hiddenOk.ok, hiddenOk.detail)

    // ===== POP2 兜底导航抑制（隐藏页触发，后台打开）=====
    const beforeFallback = await tabState()
    await testPage.evaluate(() => document.querySelector('#fallback')?.click())
    const fallbackPage = await findPage('/fallback.html')
    await sleep(1200)
    const afterFallback = await tabState()
    record(
      'POP2',
      !!fallbackPage &&
        afterFallback.count === beforeFallback.count + 1 &&
        testPage.url() === `${base}/index.html`,
      `新Tab=${!!fallbackPage}；Tab数 ${beforeFallback.count}→${afterFallback.count}；原页=${testPage.url()}（应保持 index.html）`,
    )

    // ===== POP3 自复制 → deny =====
    const beforeSelf = await tabState()
    await testPage.evaluate(() => document.querySelector('#self-dup')?.click())
    await sleep(1200)
    const afterSelf = await tabState()
    record(
      'POP3',
      afterSelf.count === beforeSelf.count && testPage.url() === `${base}/index.html`,
      `Tab数 ${beforeSelf.count}→${afterSelf.count}；原页=${testPage.url()}`,
    )

    // ===== POP7 后台 opener 自发弹窗 → 后台打开，不抢 active/焦点（门控）=====
    await chromePage.evaluate(
      ({ base }) => window.ipcRenderer.invoke('shell:tabCreate', { url: `${base}/other2.html` }),
      { base },
    )
    const other2Page = await findPage('/other2.html')
    await other2Page.waitForLoadState('domcontentloaded')
    await sleep(600)
    const beforeBg = await tabState()
    const bWcId = beforeBg.activeWcId
    const bActiveUrl = beforeBg.activeUrl
    await testPage.evaluate(() => window.open('/bg.html'))
    const bgPage = await findPage('/bg.html')
    await sleep(1200)
    const afterBg = await tabState()
    const bgFocusReady = beforeBg.focusedWebContentsId !== null
    const bgFocusOk = !bgFocusReady || afterBg.focusedWebContentsId === bWcId
    record(
      'POP7',
      !!bgPage &&
        afterBg.count === beforeBg.count + 1 &&
        afterBg.activeUrl === bActiveUrl &&
        bgFocusOk,
      `新Tab=${!!bgPage}；active 保持=${afterBg.activeUrl === bActiveUrl}；` +
        `焦点 前=${beforeBg.focusedWebContentsId} 后=${afterBg.focusedWebContentsId}/期望=${bWcId}` +
        `${bgFocusReady ? '' : '（环境无 OS 焦点：不抢焦点=active 不变，已硬断言）'}；tabs=${afterBg.tabs.map(t => `${t.id}:${t.url.split('/').pop()}`).join(',')}`,
    )

    // ===== POP8 intent-navigate（调试注入）→ 同页折叠，不新 Tab =====
    await chromePage.evaluate(
      ({ base }) => window.ipcRenderer.invoke('shell:tabCreate', { url: `${base}/fold.html` }),
      { base },
    )
    const foldPage = await findPage('/fold.html')
    await foldPage.waitForLoadState('domcontentloaded')
    await sleep(500)
    const foldState = await tabState()
    const foldWcId = (await debug()).tabs.find(t => t.id === foldState.activeId)?.wcId
    await app.evaluate(({ app: a }, wcId) => a.__shellPopupMode(wcId, 'navigate'), foldWcId)
    const beforeFold = await tabState()
    await foldPage.evaluate(() => document.querySelector('#same-path')?.click())
    await sleep(1500)
    const afterFold = await tabState()
    record(
      'POP8',
      afterFold.count === beforeFold.count && foldPage.url().startsWith(`${base}/other.html`),
      `Tab数 ${beforeFold.count}→${afterFold.count}（应不变）；当前页=${foldPage.url()}（应折叠到 other.html）`,
    )
    await app
      .evaluate(({ app: a }, wcId) => a.__shellPopupMode(wcId, null), foldWcId)
      .catch(() => {})

    // ===== POP10 日志契约：activate/openerActive 字段与行为一致 =====
    await sleep(500)
    const logs = logLines.join('')
    const fg = /activate=true openerActive=true/.test(logs)
    const bg = /activate=false openerActive=false/.test(logs)
    const suppressed = /popup-fallback-navigation-suppressed/.test(logs)
    const intentFold = /popup-rule=intent-navigate/.test(logs)
    record(
      'POP10',
      fg && bg && suppressed && intentFold,
      `foreground=${fg} background=${bg} suppressed=${suppressed} intentFold=${intentFold}`,
    )

    // ===== 清理测试 Tab =====
    for (const t of (await tabsList()).tabs) {
      if ((t.url || '').startsWith(base)) {
        await chromePage.evaluate(id => window.ipcRenderer.invoke('shell:tabClose', id), t.id)
      }
    }
  } finally {
    try {
      if (browser) await browser.close()
    } catch {}
    try {
      await app.close()
    } catch {}
    server.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('E2E 异常：', err)
  process.exit(1)
})
