// 入口启动/选择/自由浏览/autoRestore/记住开关 E2E（shell-entry-platform-selector v2）
// 运行：npx vite build && node poc/shell/e2e-entry-startup.mjs
import path from 'node:path'
import { _electron as electron } from 'playwright'

const repo = path.resolve(import.meta.dirname, '../..')
const profile = `/tmp/lm-e2e-entry-startup-${Date.now()}`
const results = []
const record = (id, ok, detail = '') => {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(fn, timeout, label) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(150)
  }
  throw new Error(`等待超时：${label}`)
}

async function launch() {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    cwd: repo,
    env: { ...process.env, LM_SHELL_DEBUG: '1' },
    timeout: 30_000,
  })
  const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
  const pageBy = needle =>
    waitFor(() => app.windows().find(w => w.url().includes(needle)), 30_000, `页面 ${needle}`)
  return { app, debug, pageBy }
}

async function main() {
  let ctx = await launch()
  try {
    const d = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.entryVisible && s.shellMode === 'entry' ? s : null
      },
      20_000,
      'entry 首屏',
    )
    record(
      'ES-1 首屏 entry + 52 顶栏 + 满宽 1280',
      d.chromeHeight === 52 && d.entryBounds?.width === 1280 && d.pageBounds === null,
      JSON.stringify({ mode: d.shellMode, chrome: d.chromeHeight, entry: d.entryBounds }),
    )
    const order = d.childrenUrls ?? []
    record(
      'ES-2 层级 [page, entry, chrome, rail]',
      order.length >= 4 &&
        order[1]?.includes('entry.html') &&
        order[2]?.includes('chrome.html') &&
        order[3]?.includes('rail.html'),
      JSON.stringify(order),
    )

    const entry = await ctx.pageBy('entry.html')
    record(
      'ES-3 入口标题/平台卡/三列',
      (await entry.locator('h1').innerText()) === '选择直播平台' &&
        (await entry.locator('[data-platform]').count()) === 3 &&
        (await entry.evaluate(
          () =>
            getComputedStyle(
              document.querySelector('[data-platform]')?.parentElement,
            ).gridTemplateColumns.split(' ').length,
        )) === 3,
      `h1=${await entry.locator('h1').innerText()}`,
    )
    const chrome = await ctx.pageBy('chrome.html')
    const chromeState = await chrome.evaluate(() => ({
      text: document.body.innerText,
      addressInputs: document.querySelectorAll('input[placeholder="搜索或输入网址"]').length,
    }))
    record(
      'ES-4 entry 模式 Chrome 无工具条 + 文案',
      chromeState.text.includes('选择平台') && chromeState.addressInputs === 0,
      JSON.stringify(chromeState),
    )

    // ES-4b：entry 模式菜单守卫（菜单只属于非 entry 表面）
    await chrome.locator('button[title="展开 Live Mod 功能菜单"]').click()
    await sleep(250)
    const entryMenu = await ctx.debug()
    record(
      'ES-4b entry 模式菜单守卫生效',
      entryMenu.menuOpen === false && entryMenu.shellMode === 'entry',
      JSON.stringify({ menu: entryMenu.menuOpen, mode: entryMenu.shellMode }),
    )

    await entry.locator('[data-testid="entry-skip"]').click()
    const browse = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.shellMode === 'browse' && !s.entryVisible ? s : null
      },
      10_000,
      '暂不进入 → browse',
    )
    record(
      'ES-5 先自由浏览 → browse + page 出现',
      browse.pageBounds?.width === 1280,
      JSON.stringify({ mode: browse.shellMode, page: browse.pageBounds }),
    )
  } catch (e) {
    record('ES-1..5 启动链路', false, String(e.message ?? e))
  } finally {
    await ctx.app.close().catch(() => {})
  }

  // 第二次启动：选择平台 → live → 记住；关闭后同 profile 应 autoRestore live
  ctx = await launch()
  try {
    await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.entryVisible ? s : null
      },
      20_000,
      'entry 重新出现',
    )
    const entry = await ctx.pageBy('entry.html')
    await entry.locator('[data-platform="douyin"]').click()
    const live = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.shellMode === 'live' && !s.entryVisible ? s : null
      },
      15_000,
      '选择平台 → live',
    )
    record('ES-6 选择平台 → live + 入口隐藏', true, JSON.stringify({ mode: live.shellMode }))
  } catch (e) {
    record('ES-6 选择平台 → live + 入口隐藏', false, String(e.message ?? e))
  } finally {
    await ctx.app.close().catch(() => {})
  }

  ctx = await launch()
  try {
    const auto = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.shellMode === 'live' && !s.entryVisible ? s : null
      },
      20_000,
      'autoRestore live',
    )
    record('ES-7 记住后自动进 live', true, JSON.stringify({ mode: auto.shellMode }))

    const rail = await ctx.pageBy('rail.html')
    await rail.evaluate(() => window.ipcRenderer.invoke('shell:entryReopen'))
    const reopened = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.shellMode === 'entry' && s.entryVisible ? s : null
      },
      10_000,
      'entryReopen → entry',
    )
    record(
      'ES-8 切换平台 → entry 且 dock 关闭',
      reopened.panelOpen === false,
      JSON.stringify({ mode: reopened.shellMode, panelOpen: reopened.panelOpen }),
    )

    const entry = await ctx.pageBy('entry.html')
    await entry.locator('[data-testid="entry-remember"]').click()
    await sleep(300)
  } catch (e) {
    record('ES-7/8 autoRestore / 切换平台', false, String(e.message ?? e))
  } finally {
    await ctx.app.close().catch(() => {})
  }

  ctx = await launch()
  try {
    const selector = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.shellMode === 'entry' && s.entryVisible ? s : null
      },
      20_000,
      '记住关闭后回到 entry',
    )
    record(
      'ES-9 关闭记住 → 下次首屏选择器',
      Boolean(selector),
      JSON.stringify({ mode: selector.shellMode }),
    )
  } catch (e) {
    record('ES-9 关闭记住 → 下次首屏选择器', false, String(e.message ?? e))
  } finally {
    await ctx.app.close().catch(() => {})
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n== entry E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => {
  console.error('E2E 运行失败（检查前置：npx vite build）：', e)
  process.exit(1)
})
