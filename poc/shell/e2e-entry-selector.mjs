// 已退役（第二期）：启动入口改为 workspace 工作台，旧平台选择器不再抢首屏。
// 保留文件用于历史对照；新启动路径见 poc/shell/e2e-workbench.mjs。
// 原：壳入口平台选择器 E2E（shell-entry-platform-selector v1 · EC-1~EC-5）
// 前置：npx vite build 产出 dist + dist-electron（生产形态：entry.html/chrome.html/rail.html 三入口）
// 契约（主进程仅 LM_SHELL_DEBUG=1 注册，生产不暴露）：
//   app.__shellDebug(): { panelOpen, routeId, railWidth, entryVisible, entryUrl, entryBounds, expectedEntryBounds, childrenUrls }
// 入口页面驱动：app 自身 remote-debugging-port（随机端口）+ profile/DevToolsActivePort 发现 → connectOverCDP
// 运行：env -u ELECTRON_RUN_AS_NODE node poc/shell/e2e-entry-selector.mjs
// 说明：E2E 不触碰真实用户 profile；记忆文件写在每次唯一的 /tmp/lm-e2e-entry-* profile 内。
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium, _electron as electron } from 'playwright'

const repo = path.resolve(import.meta.dirname, '../..')
const profile = `/tmp/lm-e2e-entry-${Date.now()}`
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

function childEnv() {
  const env = {
    ...process.env,
    LM_SHELL_UI: '1',
    LM_SHELL_DEBUG: '1',
    LM_SHELL_NOTICE_TEST_MS: '300',
    ELECTRON_DISABLE_SANDBOX: '1',
  }
  // 本会话 bash 默认注入 ELECTRON_RUN_AS_NODE=1：会把 Electron 当 Node 跑，必须剔除
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function launchApp(profileDir = profile) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profileDir}`, '--no-sandbox'],
    cwd: repo,
    env: childEnv(),
  })
  const mainLog = []
  app.process().stdout?.on('data', d => mainLog.push(d.toString()))
  app.process().stderr?.on('data', d => mainLog.push(d.toString()))
  const win = await app.firstWindow({ timeout: 30_000 })
  await win.waitForLoadState().catch(() => {})
  const debug = () =>
    app.evaluate(({ app: a }) => {
      if (!a.__shellDebug) throw new Error('LM_SHELL_DEBUG 契约缺失')
      return a.__shellDebug()
    })
  await waitFor(() => debug(), 15_000, 'shellDebug 就绪')
  const port = readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf-8')
    .split('\n')[0]
    .trim()
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const pages = () => cdp.contexts().flatMap(c => c.pages())
  const pageBy = async (needle, timeoutMs = 30_000) =>
    waitFor(() => pages().find(p => p.url().includes(needle)), timeoutMs, `页面 ${needle}`)
  const tabState = async () => {
    const rail = await pageBy('rail.html')
    return rail.evaluate(() => window.ipcRenderer.invoke('shell:tabsList'))
  }
  const invoke = async (channel, ...args) => {
    const rail = await pageBy('rail.html')
    return rail.evaluate(([c, a]) => window.ipcRenderer.invoke(c, ...a), [channel, args])
  }
  return { app, win, cdp, mainLog, debug, pages, pageBy, tabState, invoke }
}

async function teardown(ctx) {
  await ctx?.cdp?.close().catch(() => {})
  await ctx?.app?.close().catch(() => {})
}

function noOrphanChrome() {
  try {
    const out = execSync('pgrep -fl "playwright_chromiumdev_profile" || true').toString().trim()
    return out === ''
  } catch {
    return true
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })

  let ctx = await launchApp()

  // ---- EC-1 启动即入口（隐藏等待 railReady → 显示）：层级 [page, entry, chrome, rail] + 几何 ----
  try {
    const d = await waitFor(
      async () => {
        const s = await ctx.debug()
        return s.entryVisible ? s : null
      },
      15_000,
      '入口可见',
    )
    const orderOk =
      (d.childrenUrls[1] ?? '').includes('entry.html') &&
      (d.childrenUrls[2] ?? '').includes('chrome.html') &&
      (d.childrenUrls[3] ?? '').includes('rail.html')
    const boundsOk = JSON.stringify(d.entryBounds) === JSON.stringify(d.expectedEntryBounds)
    const noticeOk =
      (d.noticeUrl ?? '').includes('notice.html') &&
      JSON.stringify(d.noticeBounds) === JSON.stringify(d.expectedNoticeBounds)
    record(
      'EC-1 启动即入口 + 层级/几何',
      orderOk && boundsOk && noticeOk && d.childrenUrls.length >= 4,
      `entryVisible=${d.entryVisible} bounds=${JSON.stringify(d.entryBounds)} notice=${noticeOk} order=${JSON.stringify(d.childrenUrls)}`,
    )
    // 证据：优先整窗 capturePage；窗口被遮挡/未绘帧时退回逐 view 捕获
    const shots = await ctx.app.evaluate(async ({ BrowserWindow }) => {
      const win =
        BrowserWindow.getAllWindows().find(w => w.contentView.children.length > 0) ??
        BrowserWindow.getAllWindows()[0]
      win.show()
      win.focus()
      await new Promise(r => setTimeout(r, 600))
      const toB64 = async wc => Buffer.from((await wc.capturePage()).toPNG()).toString('base64')
      return {
        window: Buffer.from((await win.capturePage()).toPNG()).toString('base64'),
        views: await Promise.all(
          win.contentView.children.slice(1).map(async c => ({
            url: c.webContents.getURL(),
            png: await toB64(c.webContents),
          })),
        ),
      }
    })
    // 整窗 capturePage 在窗口被遮挡/未 compositing 时可能为空：有内容才落盘（证据不伪造空文件）
    const windowPng = Buffer.from(shots.window, 'base64')
    if (windowPng.length > 0) writeFileSync(path.join(outDir, 'window-entry.png'), windowPng)
    console.log(
      `[evidence] views=${shots.views.length} windowCapture=${windowPng.length > 0 ? 'ok' : 'occluded→逐 view 已落盘'}`,
    )
    for (const [i, v] of shots.views.entries()) {
      const name = `${v.url.match(/(entry|chrome|rail)/)?.[0] ?? `view-${i}`}-view.png`
      writeFileSync(path.join(outDir, name), Buffer.from(v.png, 'base64'))
    }
    const entryPage = await ctx.pageBy('entry.html', 15_000)
    await entryPage.screenshot({ path: path.join(outDir, 'entry-selector.png'), timeout: 15_000 })
  } catch (e) {
    record('EC-1 启动即入口 + 层级/几何', false, String(e.message ?? e))
  }

  // ---- EC-2 点「抖店」卡片 → 入口隐藏 + 壳内账号 Tab + fxg 登录页 + 无外部浏览器 ----
  try {
    const entryPage = await ctx.pageBy('entry.html')
    const tabsBefore = await ctx.tabState()
    await entryPage.click('[data-platform="douyin"]')
    const hidden = await waitFor(
      async () => ((await ctx.debug()).entryVisible ? null : true),
      8_000,
      '入口隐藏',
    )
    const loginPage = await ctx.pageBy('fxg.jinritemai.com', 40_000)
    const tabsAfter = await ctx.tabState()
    const tabAdded = tabsAfter.tabs.length > tabsBefore.tabs.length
    record(
      'EC-2 选择即进入（壳内 Tab + 登录页 + 无外部浏览器）',
      Boolean(hidden) && Boolean(loginPage) && tabAdded && noOrphanChrome(),
      `hidden=${hidden} tab=${tabsAfter.tabs.length - tabsBefore.tabs.length} url=${loginPage.url().slice(0, 90)} external=${noOrphanChrome() ? '无' : '有'}`,
    )
  } catch (e) {
    record('EC-2 选择即进入（壳内 Tab + 登录页 + 无外部浏览器）', false, String(e.message ?? e))
  }

  // ---- EC-4 中控台「切换平台」重开入口 → 暂不进入（不新增 Tab，入口隐藏） ----
  try {
    await ctx.invoke('shell:entryReopen')
    await waitFor(
      async () => ((await ctx.debug()).entryVisible ? true : null),
      8_000,
      '入口重新显示',
    )
    const entryPage = await ctx.pageBy('entry.html')
    const before = await ctx.tabState()
    await entryPage.click('[data-testid="entry-skip"]')
    await waitFor(async () => ((await ctx.debug()).entryVisible ? null : true), 8_000, '入口隐藏')
    const after = await ctx.tabState()
    record(
      'EC-4 重开入口 + 暂不进入',
      before.tabs.length === after.tabs.length,
      `tabs ${before.tabs.length} → ${after.tabs.length}`,
    )
  } catch (e) {
    record('EC-4 重开入口 + 暂不进入', false, String(e.message ?? e))
  }

  // ---- EC-6 页面缩放快捷键：Cmd+= → 110%，Cmd+0 → 100%（按站点记忆核心路径）----
  try {
    const sendZoomKey = keyCode =>
      ctx.app.evaluate(({ BrowserWindow }, key) => {
        const win =
          BrowserWindow.getAllWindows().find(w => w.contentView.children.length > 0) ??
          BrowserWindow.getAllWindows()[0]
        const page = win.contentView.children[0]
        page.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['meta'] })
        page.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['meta'] })
      }, keyCode)
    const before = (await ctx.debug()).zoomPercent
    await sendZoomKey('=')
    await sleep(400)
    const zoomed = (await ctx.debug()).zoomPercent
    await sendZoomKey('0')
    await sleep(400)
    const reset = (await ctx.debug()).zoomPercent
    record(
      'EC-6 页面缩放快捷键（Cmd+= / Cmd+0）',
      before === 100 && zoomed === 110 && reset === 100,
      `100 → ${zoomed} → ${reset}`,
    )
  } catch (e) {
    record('EC-6 页面缩放快捷键（Cmd+= / Cmd+0）', false, String(e.message ?? e))
  }

  // ---- EC-7 外部协议深链拦截：bytedance:// 不得逃逸系统（真实缺陷 E2 回归）----
  try {
    const httpPage = ctx.pages().find(p => /^https?:/.test(p.url()))
    if (!httpPage) throw new Error('无可用于探测的 http 页面')
    const urlBefore = httpPage.url()
    await httpPage
      .evaluate(() => {
        location.href = 'bytedance://dispatch_message/e2e-probe'
      })
      .catch(() => {})
    await sleep(1200)
    const log = ctx.mainLog.join('')
    const blocked = /已拦截非 http\(s\) 页面导航/.test(log)
    // 深链被拦截后页面仍应是 http(s)（官方页可能同时发生自身跳转，故只断言协议未被外部协议替换）
    const unchanged = /^https?:/.test(httpPage.url())
    record(
      'EC-7 外部协议深链拦截（bytedance://）',
      blocked && unchanged,
      `blocked=${blocked} stillHttp=${unchanged} before=${urlBefore.slice(0, 40)}`,
    )
  } catch (e) {
    record('EC-7 外部协议深链拦截（bytedance://）', false, String(e.message ?? e))
  }

  // ---- EC-8 通知覆盖层：置顶/几何/自动消失（测试时长 300ms 由 LM_SHELL_NOTICE_TEST_MS 注入） ----
  try {
    await ctx.invoke('shell:notify', { variant: 'error', description: 'E2E 通知置顶探针' })
    const noticePage = await ctx.pageBy('notice.html', 15_000)
    const countUp = await waitFor(
      async () => {
        const n = await noticePage.evaluate(
          () => document.querySelectorAll('[data-notice-item]').length,
        )
        return n > 0 ? n : null
      },
      8_000,
      '通知出现',
    )
    const d = await ctx.debug()
    const geomOk = JSON.stringify(d.noticeBounds) === JSON.stringify(d.expectedNoticeBounds)
    const urlOk = (d.noticeUrl ?? '').includes('notice.html')
    const png = await ctx.app
      .evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find(x =>
          x.webContents.getURL().includes('notice.html'),
        )
        if (!w) return null
        return Array.from((await w.webContents.capturePage()).toPNG())
      })
      .catch(() => null)
    if (png) writeFileSync(path.join(outDir, 'notice-topmost.png'), Buffer.from(png))
    const gone = await waitFor(
      async () => {
        const n = await noticePage.evaluate(
          () => document.querySelectorAll('[data-notice-item]').length,
        )
        return n === 0 ? true : null
      },
      8_000,
      '通知自动消失',
    )
    record(
      'EC-8 通知覆盖层（置顶/几何/自动消失）',
      Boolean(countUp) && geomOk && urlOk && Boolean(gone),
      `count=${countUp} geom=${geomOk} autoDismiss=${gone} bounds=${JSON.stringify(d.noticeBounds)}`,
    )
  } catch (e) {
    record('EC-8 通知覆盖层（置顶/几何/自动消失）', false, String(e.message ?? e))
  }

  // ---- EC-10 空态 a11y：aria-live 常驻（即使 0 条通知）----
  try {
    const noticePage = await ctx.pageBy('notice.html')
    const live = await noticePage.evaluate(() =>
      Boolean(document.querySelector('[role="status"][aria-live="polite"]')),
    )
    record('EC-10 空态 aria-live 常驻', live, `liveRegion=${live}`)
  } catch (e) {
    record('EC-10 空态 aria-live 常驻', false, String(e.message ?? e))
  }

  // ---- EC-8b 面板展开时通知仍最顶（D4 决策固化），且壳内层级不变量不变 ----
  try {
    await ctx.invoke('shell:railToggle', 'popup')
    await sleep(500)
    await ctx.invoke('shell:notify', { variant: 'warning', description: '面板展开时通知探针' })
    const noticePage = await ctx.pageBy('notice.html')
    await waitFor(
      async () => {
        const n = await noticePage.evaluate(
          () => document.querySelectorAll('[data-notice-item]').length,
        )
        return n > 0 ? n : null
      },
      8_000,
      '面板展开时通知出现',
    )
    const d = await ctx.debug()
    const urls = d.childrenUrls
    const entryIdx = urls.findIndex(u => u.includes('entry.html'))
    const chromeIdx = urls.findIndex(u => u.includes('chrome.html'))
    const railIdx = urls.findIndex(u => u.includes('rail.html'))
    const orderOk = entryIdx >= 1 && chromeIdx === entryIdx + 1 && railIdx === chromeIdx + 1 // 页面区(≥1 pageView) < entry < chrome < rail
    const geomOk = JSON.stringify(d.noticeBounds) === JSON.stringify(d.expectedNoticeBounds)
    record(
      'EC-8b 面板展开时通知仍置顶',
      orderOk && geomOk,
      `panelOpen=${d.panelOpen} order=${JSON.stringify(d.childrenUrls)} boundsOk=${geomOk}`,
    )
    await ctx.invoke('shell:railToggle', 'popup') // 收起面板
  } catch (e) {
    record('EC-8b 面板展开时通知仍置顶', false, String(e.message ?? e))
  }

  // ---- EC-3 记住选择：重启同 profile → 跳过入口 + 自动恢复（直接进登录页/中控台） ----
  try {
    await teardown(ctx)
    await sleep(1500)
    ctx = await launchApp()
    await sleep(2500) // 给 restore 派发与 attach 建立留出起跑时间
    const d = await ctx.debug()
    const entrySkipped = d.entryVisible === false
    const restored = await ctx.pageBy('fxg.jinritemai.com', 40_000)
    record(
      'EC-3 重启记忆恢复（跳过入口自动进入）',
      entrySkipped && Boolean(restored),
      `entryVisible=${d.entryVisible} url=${restored.url().slice(0, 90)}`,
    )
  } catch (e) {
    record('EC-3 重启记忆恢复（跳过入口自动进入）', false, String(e.message ?? e))
  }

  await teardown(ctx)

  // ---- EC-5 跨域登录 fold：独立 profile 直选「巨量百应」→ 登录页留在壳内（真实缺陷 E1 回归）----
  // 独立实例原因：同 profile 同账号已有 douyin 会话，二次连接会踢掉旧会话干扰折叠链路断言
  let ctx2 = null
  try {
    const profile2 = `${profile}-buyin`
    ctx2 = await launchApp(profile2)
    const entryPage = await ctx2.pageBy('entry.html', 15_000)
    const chromiumBefore = execSync('pgrep -f "playwright_chromiumdev_profile" || true')
      .toString()
      .trim()
    await entryPage.click('[data-platform="buyin"]')
    // 等折叠日志（登录弹窗被折入壳内）或百应/登录页出现
    const folded = await waitFor(
      async () => {
        const log = ctx2.mainLog.join('')
        return /popup-rule=fold/.test(log) ? true : null
      },
      40_000,
      '百应登录弹窗 fold 日志',
    ).catch(() => false)
    const buyinPage = await waitFor(
      () => ctx2.pages().find(p => /buyin\.jinritemai|douyinec/.test(p.url())),
      20_000,
      '百应页（壳内）',
    ).catch(() => null)
    await sleep(1500)
    const chromiumAfter = execSync('pgrep -f "playwright_chromiumdev_profile" || true')
      .toString()
      .trim()
    const noNewExternal = chromiumBefore === chromiumAfter
    record(
      'EC-5 跨域登录 fold 入壳（百应 douyinec↔jinritemai）',
      Boolean(folded) && Boolean(buyinPage) && noNewExternal,
      `fold=${folded} url=${buyinPage?.url()?.slice(0, 80) ?? '无'} 无新增外部浏览器=${noNewExternal}`,
    )
  } catch (e) {
    record('EC-5 跨域登录 fold 入壳（百应 douyinec↔jinritemai）', false, String(e.message ?? e))
  } finally {
    await teardown(ctx2)
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n== E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async e => {
  console.error('E2E 运行失败（检查前置：npx vite build）：', e)
  process.exit(1)
})
