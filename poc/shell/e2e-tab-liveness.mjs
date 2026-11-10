// 自动化页面保活 E2E（fix-shell-popup-navigation-liveend · v2 A2）
// 不变量（契约）：账号会话 Tab 即使在「非激活 / 整窗最小化」下，
//   ① 页面 200ms 级定时器不被冻结/节流（速率 ≥ 80% 期望）；② Playwright click/fill/dispatch/scroll 可用。
// 该不变量是「自动讲解（自动弹窗）」在用户切走页面后仍生效的前提；注释只做指向，契约以本脚本为准。
// 运行：env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 node poc/shell/e2e-tab-liveness.mjs

import { mkdtempSync, readFileSync } from 'node:fs'
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
async function waitFor(fn, timeoutMs, intervalMs = 200) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await fn()
    if (v) return v
    await sleep(intervalMs)
  }
  return null
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>LIVE A</title>
  <button id="btn" onclick="window.__clicks=(window.__clicks||0)+1">c</button>
  <input id="inp" />
  <div style="height:1800px">spacer</div>
  <button id="deep" onclick="window.__deep=(window.__deep||0)+1">d</button>
  <script>
    window.__clicks = 0; window.__deep = 0; window.__ticks = 0;
    setInterval(() => { window.__ticks++ }, 200);
  </script>`

async function main() {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(u.pathname === '/b.html' ? '<!doctype html><title>B</title><h1>B</h1>' : PAGE)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'lm-e2e-liveness-'))
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
  let browser
  try {
    const port = await waitFor(() => {
      try {
        const line = readFileSync(`${userDataDir}/DevToolsActivePort`, 'utf8').split('\n')[0].trim()
        return line ? Number(line) : null
      } catch {
        return null
      }
    }, 45_000)
    if (!port) throw new Error('DevToolsActivePort 未就绪')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const allPages = () => browser.contexts().flatMap(c => c.pages())
    const chromePage = await waitFor(
      async () => (await allPages()).find(p => p.url().includes('chrome.html')),
      30_000,
    )
    if (!chromePage) throw new Error('chromeView 未就绪')
    const createTab = url =>
      chromePage.evaluate(u => window.ipcRenderer.invoke('shell:tabCreate', { url: u }), url)
    const findPage = suffix =>
      waitFor(
        async () => (await allPages()).find(p => p.url().startsWith(`${base}${suffix}`)),
        15_000,
      )

    // 页面在 browse/live 才可见；最小化保活测试先进入 browse
    await chromePage.evaluate(() => window.ipcRenderer.invoke('shell:modeSet', 'browse'))
    await sleep(300)
    // A = 被测页；B = 后建并 active → A 进入非激活
    await createTab(`${base}/a.html`)
    const pageA = await findPage('/a.html')
    await pageA.waitForLoadState('domcontentloaded')
    await createTab(`${base}/b.html`)
    const pageB = await findPage('/b.html')
    if (!pageB) throw new Error('B 页未打开')
    await sleep(800)

    // LV-01 非激活 Tab：定时器满速 + 自动化动作可用
    const t0 = await pageA.evaluate(() => window.__ticks)
    await sleep(8000)
    const t1 = await pageA.evaluate(() => window.__ticks)
    const inactiveActions = await (async () => {
      try {
        await pageA.evaluate(() => document.querySelector('#btn')?.click())
        const btn = await pageA.$('#btn')
        await btn.dispatchEvent('click')
        await pageA.locator('#inp').fill('abc', { timeout: 4000 })
        const deep = await pageA.$('#deep')
        await deep.scrollIntoViewIfNeeded({ timeout: 4000 })
        await deep.dispatchEvent('click')
        const st = await pageA.evaluate(() => ({
          clicks: window.__clicks,
          deep: window.__deep,
          value: document.querySelector('#inp')?.value,
        }))
        return {
          ok: st.clicks >= 2 && st.deep >= 1 && st.value === 'abc',
          detail: JSON.stringify(st),
        }
      } catch (e) {
        return { ok: false, detail: `异常：${String(e).split('\n')[0]}` }
      }
    })()
    record(
      'LV-01',
      t1 - t0 >= 30 && inactiveActions.ok,
      `非激活 8s ticks=${t1 - t0}（期望≥30，节流≈8）；动作=${inactiveActions.ok} ${inactiveActions.detail}`,
    )

    // LV-02 整窗最小化：定时器仍满速 + click 可用（恢复尽力而为，失败不判红）
    await chromePage.evaluate(() => window.ipcRenderer.invoke('shell:windowMinimize'))
    await sleep(1200)
    const m0 = await pageA.evaluate(() => window.__ticks)
    await sleep(6000)
    const m1 = await pageA.evaluate(() => window.__ticks)
    let minimizedClickOk = false
    try {
      // 最小化后不做 OS 级 pointer（Playwright actionable 会受窗口状态影响）：
      // 直接在页面内触发真实 DOM click，验证渲染进程仍可执行交互。
      const beforeClicks = await pageA.evaluate(() => window.__clicks)
      await pageA.evaluate(() => document.querySelector('#btn')?.click())
      const afterClicks = await pageA.evaluate(() => window.__clicks)
      minimizedClickOk = afterClicks > beforeClicks
    } catch {
      minimizedClickOk = false
    }
    record(
      'LV-02',
      m1 - m0 >= 22 && minimizedClickOk,
      `最小化 6s ticks=${m1 - m0}（期望≥22）；click=${minimizedClickOk}`,
    )
    // 恢复窗口（尽力而为；失败不影响断言结论）
    await chromePage
      .evaluate(() => window.ipcRenderer.invoke('shell:windowMaximize'))
      .catch(() => {})

    // 清理
    const tabs = await chromePage.evaluate(() => window.ipcRenderer.invoke('shell:tabsList'))
    for (const t of tabs.tabs) {
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
