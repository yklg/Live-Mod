// 旧「面板连接」壳内登录链路回归 E2E（自包含：spawn Electron → CDP 驱动 → 清理）
// 覆盖：V0 三入口存活 / V1 面板 LiveControl / V2 壳内 Tab 承载登录页 / V3 无外部浏览器 / V4 登录页截图
// 前置：npx vite build（dist + dist-electron 就绪）
// 运行：node poc/shell/e2e-shell-login.mjs
import { execSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const repo = path.resolve(import.meta.dirname, '../..')
const profile = `/tmp/lm-e2e-login-${Date.now()}`
const outDir = path.join(repo, '.screenshots/shell-entry')
const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await Promise.resolve()
      .then(fn)
      .catch(() => null)
    if (v) return v
    await sleep(300)
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const env = {
    ...process.env,
    LM_SHELL_UI: '1',
    LM_SHELL_DEBUG: '1',
    ELECTRON_DISABLE_SANDBOX: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    'node_modules/.bin/electron',
    ['.', '--no-sandbox', `--user-data-dir=${profile}`],
    {
      cwd: repo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let log = ''
  child.stdout?.on('data', d => (log += d.toString()))
  child.stderr?.on('data', d => (log += d.toString()))

  let browser = null
  try {
    const portFile = path.join(profile, 'DevToolsActivePort')
    const port = await waitFor(
      () => readFileSync(portFile, 'utf-8').split('\n')[0].trim(),
      30_000,
      'DevToolsActivePort',
    )
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const pages = () => browser.contexts().flatMap(c => c.pages())
    const rail = await waitFor(
      () => pages().find(p => p.url().includes('rail.html')),
      30_000,
      'rail 入口',
    )
    const chrome = await waitFor(
      () => pages().find(p => p.url().includes('chrome.html')),
      30_000,
      'chrome 入口',
    )
    record(
      'V0 三入口存活',
      Boolean(rail && chrome),
      `pages=${pages()
        .map(p => p.url().slice(-28))
        .join(' | ')}`,
    )

    // V1 面板内 LiveControl
    await rail.evaluate(() => window.ipcRenderer.invoke('shell:railToggle', 'live'))
    await sleep(1200)
    const connectBtn = rail.locator('[data-testid="connect-live"]').first()
    record('V1 面板内 LiveControl 页', (await connectBtn.count()) > 0, '连接按钮命中')

    // V2 点击连接 → 壳内 Tab 承载登录页（attach 链路）
    await connectBtn.click()
    const loginPage = await waitFor(
      () => pages().find(p => /fxg\.jinritemai\.com\/login|douyinec\.com/.test(p.url())),
      45_000,
      '壳内登录页',
    )
    record('V2 壳内 Tab 承载登录页', Boolean(loginPage), loginPage.url().slice(0, 90))

    // V5-V7 中控默认缩放 80% / host 记忆优先 / 无记忆回落默认。
    // 断言窗口 CSS 宽度：1280/0.8=1600，1280/0.9≈1422（不依赖主进程调试契约）。
    // 说明：Cmd+= / Cmd+0 的键盘路径由 pageZoom/shellMenu 单测覆盖；CDP keyboard 不触发
    // Electron before-input-event（实测），故这里通过 shell-zoom.json 落盘验证加载/回落链路。
    const viewportWidth = () => loginPage.evaluate(() => window.innerWidth).catch(() => 0)
    const zoomFile = path.join(profile, 'shell-zoom.json')
    const reloadAndWidth = async () => {
      await loginPage.reload()
      await loginPage.waitForLoadState('domcontentloaded').catch(() => {})
      await sleep(1200)
      return viewportWidth()
    }
    await sleep(1200)
    const w80 = await viewportWidth()
    record('V5 中控默认缩放 80%', Math.abs(w80 - 1600) <= 60, `innerWidth=${w80}`)
    writeFileSync(zoomFile, JSON.stringify({ version: 1, byHost: { 'fxg.jinritemai.com': 0.9 } }))
    const w90 = await reloadAndWidth()
    record('V6 host 记忆优先（0.9 落盘生效）', Math.abs(w90 - 1422) <= 60, `innerWidth=${w90}`)
    writeFileSync(zoomFile, JSON.stringify({ version: 1, byHost: {} }))
    const wReset = await reloadAndWidth()
    record('V7 无记忆回落默认 80%', Math.abs(wReset - 1600) <= 60, `innerWidth=${wReset}`)

    // V3 无外部浏览器进程（launch 降级特征）
    const external = (() => {
      try {
        return execSync('pgrep -fl "playwright_chromiumdev_profile" || true').toString().trim()
      } catch {
        return ''
      }
    })()
    record('V3 无外部浏览器进程', external === '', external ? external.slice(0, 100) : '干净')

    // V4 登录页截图
    await loginPage.screenshot({
      path: path.join(outDir, 'legacy-panel-login.png'),
      timeout: 20_000,
    })
    record('V4 登录页截图', true, path.join(outDir, 'legacy-panel-login.png'))
    writeFileSync('/tmp/lm-e2e-shell-login.log', log.slice(-2000))
  } catch (e) {
    record('E2E 可恢复失败', false, String(e.message ?? e))
  } finally {
    await browser?.close().catch(() => {})
    try {
      child.kill('SIGTERM')
    } catch {}
    await sleep(800)
    try {
      execSync(`pkill -f "user-data-dir=${profile}" || true`)
    } catch {}
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n== E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => {
  console.error('E2E 运行失败：', e)
  process.exit(1)
})
