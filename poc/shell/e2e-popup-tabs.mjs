// 弹窗→新 Tab E2E（fix-shell-popup-navigation-liveend · Phase 2 · TC-POP1~POP5）
// 前置：npx vite build（dist + dist-electron 与源码一致）；本脚本注入 LM_SHELL_UI=1 LM_SHELL_DEBUG=1 启动。
// 场景全部使用本地 HTTP 测试页（绝连真实平台）；断言的是「浏览器语义」：
//   POP1 同 host 异 path 弹窗 → 开壳内新 Tab，当前页 URL/内容不变（绝不 fold 劫持）
//   POP2 官方页常见兜底 `if(!w) location.href=url` → 新 Tab 已承载，当前页兜底跳转被 will-navigate 抑制
//   POP3 自复制弹窗（window.open(同 URL)）→ deny-selfdup：不开新 Tab，当前页不变
//   POP4 弹窗 Tab 使用 opener 的 partition（登录态一致）——经 tabsList 观察到独立 Tab 条目
//   POP5 日志契约：出现 popup-rule=new-tab / popup-fallback-navigation-suppressed，且不出现 popup-rule=intent-navigate
// 运行：node poc/shell/e2e-popup-tabs.mjs（PASS/FAIL，非零退出码=失败）

import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium, _electron as electron } from 'playwright'

delete process.env.ELECTRON_RUN_AS_NODE

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
    <button id="same-path" onclick="window.open('/other.html')">same</button>
    <button id="self-dup" onclick="window.open(location.href)">self</button>
    <button id="fallback" onclick="const w=window.open('/fallback.html'); if(!w){ location.href='/fallback.html' }">fallback</button>
    <pre id="out"></pre>`,
  '/other.html': `<!doctype html><meta charset="utf-8"><title>E2E OTHER</title><h1>other</h1>`,
  '/fallback.html': `<!doctype html><meta charset="utf-8"><title>E2E FALLBACK</title><h1>fallback</h1>`,
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
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1',
      LM_SHELL_UI: '1',
      LM_SHELL_DEBUG: '1',
    },
  })
  const logLines = []
  app.process().stderr?.on('data', d => logLines.push(String(d)))
  app.process().stdout?.on('data', d => logLines.push(String(d)))

  let browser
  try {
    await app.firstWindow({ timeout: 30_000 }).catch(() => null)
    // 主进程固定 appendSwitch('remote-debugging-port', 0)：从 profile 的 DevToolsActivePort 发现
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

    const tabsList = () => chromePage.evaluate(() => window.ipcRenderer.invoke('shell:tabsList'))
    const activeTabUrl = async () => {
      const state = await tabsList()
      const active = state.tabs.find(t => t.id === state.activeId)
      return { url: active?.url ?? '', count: state.tabs.length, activated: active?.id }
    }

    // 建一个自由 Tab 承载本地测试页
    await chromePage.evaluate(
      ({ base }) => window.ipcRenderer.invoke('shell:tabCreate', { url: `${base}/index.html` }),
      { base },
    )
    const testPage = await waitFor(
      async () => (await allPages()).find(p => p.url().startsWith(`${base}/index.html`)),
      30_000,
    )
    if (!testPage) throw new Error('测试页未打开')
    await testPage.waitForLoadState('domcontentloaded')

    // POP1 同 host 异 path → 新 Tab，当前页不变
    const before = await activeTabUrl()
    await testPage.evaluate(() => document.querySelector('#same-path')?.click())
    const otherPage = await waitFor(
      async () => (await allPages()).find(p => p.url().startsWith(`${base}/other.html`)),
      15_000,
    )
    await sleep(1200)
    const afterSame = await tabsList()
    const currentUrlAfterSame = testPage.url()
    record(
      'POP1',
      !!otherPage &&
        afterSame.tabs.length === before.count + 1 &&
        currentUrlAfterSame === `${base}/index.html`,
      `新 Tab=${!!otherPage}；Tab 数 ${before.count}→${afterSame.tabs.length}；当前页=${currentUrlAfterSame}`,
    )

    // POP2 兜底导航被抑制：新 Tab 承载 /fallback.html，当前页仍是 index.html
    await testPage.bringToFront().catch(() => {})
    await testPage.evaluate(() => document.querySelector('#fallback')?.click())
    const fallbackPage = await waitFor(
      async () => (await allPages()).find(p => p.url().startsWith(`${base}/fallback.html`)),
      15_000,
    )
    await sleep(1500)
    const currentUrlAfterFallback = testPage.url()
    record(
      'POP2',
      !!fallbackPage && currentUrlAfterFallback === `${base}/index.html`,
      `新 Tab=${!!fallbackPage}；当前页=${currentUrlAfterFallback}（应保持 index.html）`,
    )

    // POP3 自复制 → deny：不开新 Tab、当前页不变
    const beforeSelf = await tabsList()
    await testPage.bringToFront().catch(() => {})
    await testPage.evaluate(() => document.querySelector('#self-dup')?.click())
    await sleep(1200)
    const afterSelf = await tabsList()
    record(
      'POP3',
      afterSelf.tabs.length === beforeSelf.tabs.length && testPage.url() === `${base}/index.html`,
      `Tab 数 ${beforeSelf.tabs.length}→${afterSelf.tabs.length}；当前页=${testPage.url()}`,
    )

    // POP4 弹窗 Tab 为独立 Tab 条目且 URL 正确（浏览器语义可观测）
    const tabUrls = (await tabsList()).tabs.map(t => t.url)
    record(
      'POP4',
      tabUrls.some(u => u.startsWith(`${base}/other.html`)) &&
        tabUrls.some(u => u.startsWith(`${base}/fallback.html`)),
      `tabs=${JSON.stringify(tabUrls)}`,
    )

    // POP5 日志契约（等日志刷出）
    await sleep(800)
    const logs = logLines.join('')
    record(
      'POP5',
      /popup-rule=new-tab/.test(logs) &&
        /popup-fallback-navigation-suppressed/.test(logs) &&
        !/popup-rule=intent-navigate/.test(logs),
      `new-tab=${/popup-rule=new-tab/.test(logs)}；fallback-suppressed=${/popup-fallback-navigation-suppressed/.test(logs)}；intent-navigate=${/popup-rule=intent-navigate/.test(logs)}`,
    )

    // 清理：关掉测试页与弹窗 Tab（避免退出时残留）
    for (const t of (await tabsList()).tabs) {
      if (t.url.startsWith(base)) {
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
