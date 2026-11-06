// 壳面板密度/容器查询 E2E（计划 v3 · TC-PD-12/13/14/15/16/17/18/19/20/21/23/24）
// 前置：npx vite build
// 运行：node poc/shell/e2e-panel-density.mjs（W1 可用 EXPECT_PANEL_W=800 预检；W2 起默认 600）
// 断言：面板内密度(16px)、折叠 aria-expanded、逐路由无横向溢出、两列列宽、弹窗居中、
//       面板宽度/页面可见宽度、minWidth 钳制、经典模式零变化（24px/20px）、明暗截图。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium, _electron as electron } from 'playwright'

const repo = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(repo, '.screenshots/shell-panel')
const stamp = Date.now()
const expectPanelW = Number(process.env.EXPECT_PANEL_W ?? 600)
const results = []
const sleep = ms => new Promise(r => setTimeout(r, ms))

function record(id, ok, detail) {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await Promise.resolve()
      .then(fn)
      .catch(() => null)
    if (v) return v
    await sleep(250)
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`)
}

function childEnv(shellUi) {
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SANDBOX: '1',
    LM_SHELL_DEBUG: '1',
    ...(shellUi ? { LM_SHELL_UI: '1' } : {}),
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function launch(profileDir, shellUi) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profileDir}`, '--no-sandbox'],
    cwd: repo,
    env: childEnv(shellUi),
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
  if (shellUi) await waitFor(() => debug(), 15_000, 'shellDebug 就绪')
  const port = readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf-8')
    .split('\n')[0]
    .trim()
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const pages = () => cdp.contexts().flatMap(c => c.pages())
  const pageBy = async (needle, timeoutMs = 30_000) =>
    waitFor(() => pages().find(p => p.url().includes(needle)), timeoutMs, `页面 ${needle}`)
  const invoke = async (channel, ...args) => {
    const rail = await pageBy('rail.html')
    return rail.evaluate(([c, a]) => window.ipcRenderer.invoke(c, ...a), [channel, args])
  }
  const captureContainer = async file => {
    // 窗口被遮挡/未激活时 capturePage 可能返回空图：先 show/focus，再失败则回退抓 rail 视图
    const result = await app.evaluate(async ({ BrowserWindow }) => {
      const w =
        BrowserWindow.getAllWindows().find(x => x.contentView.children.length > 0) ??
        BrowserWindow.getAllWindows()[0]
      w.show()
      w.focus()
      await new Promise(r => setTimeout(r, 500))
      const png = await w.webContents.capturePage()
      if (!png.isEmpty()) return { src: 'window', b64: Array.from(png.toPNG()) }
      const railWc = w.contentView.children
        .map(v => v.webContents)
        .find(wc => (wc?.getURL?.() ?? '').includes('rail.html'))
      if (railWc) {
        const railPng = await railWc.capturePage()
        return { src: 'rail', b64: Array.from(railPng.toPNG()) }
      }
      return { src: 'empty', b64: [] }
    })
    if (result.b64.length === 0) throw new Error('截图捕获为空（window+rail 均失败）')
    writeFileSync(path.join(outDir, file), Buffer.from(result.b64))
    console.log(`[evidence] ${file} via ${result.src}`)
  }
  return { app, win, mainLog, debug, pages, pageBy, invoke, captureContainer }
}

async function teardown(ctx) {
  await ctx?.cdp?.close().catch(() => {})
  await ctx?.app?.close().catch(() => {})
}

const PANEL_STYLES = () => {
  const card = document.querySelector('[data-testid="status-card"] [data-slot="card-content"]')
  const title = document.querySelector('[data-testid="page-title"]')
  return {
    cardPadding: card ? getComputedStyle(card).paddingLeft : null,
    titleFont: title ? getComputedStyle(title).fontSize : null,
    scrollW: (() => {
      // full 布局页面（AI 助手/自动回复）无 page-scroll，回退到文档滚动体
      const el = document.querySelector('[data-testid="page-scroll"]') ?? document.scrollingElement
      return el ? el.scrollWidth : null
    })(),
    clientW: (() => {
      const el = document.querySelector('[data-testid="page-scroll"]') ?? document.scrollingElement
      return el ? el.clientWidth : null
    })(),
    innerWidth: window.innerWidth,
  }
}

async function railEval(rail, fn, arg) {
  return rail.evaluate(fn, arg)
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const shellProfile = `/tmp/lm-e2e-panel-${stamp}`
  const classicProfile = `/tmp/lm-e2e-panel-classic-${stamp}`
  let ctx = null
  try {
    ctx = await launch(shellProfile, true)
    const rail = await ctx.pageBy('rail.html')
    await ctx.invoke('shell:railToggle', 'live')
    await waitFor(
      async () => {
        const d = await ctx.debug()
        return d.panelOpen && d.railWidth > 56 ? d : null
      },
      15_000,
      '面板展开',
    )
    await sleep(600)

    // ---- M1 密度/容器命中 + M2 首屏不滚动 ----
    try {
      const st = await railEval(rail, PANEL_STYLES)
      const m1 = st.cardPadding === '16px' && st.titleFont === '16px'
      const m2 = st.scrollW !== null && st.scrollW <= st.clientW + 1
      record('M1 面板密度（Card 16px / 标题 16px）', m1, JSON.stringify(st))
      record('M2 中控台首屏无横向溢出', m2, `scrollW=${st.scrollW} clientW=${st.clientW}`)
    } catch (e) {
      record('M1 面板密度（Card 16px / 标题 16px）', false, String(e.message ?? e))
      record('M2 中控台首屏无横向溢出', false, String(e.message ?? e))
    }
    await ctx.captureContainer('panel-density-light.png')

    // ---- M7 折叠 a11y（C3/C4）----
    try {
      const usage = rail.locator('[data-testid="usage-fold"] button').first()
      const before = await usage.getAttribute('aria-expanded')
      await usage.click()
      await sleep(250)
      const after = await usage.getAttribute('aria-expanded')
      const advanced = rail.locator('[data-testid="advanced-fold"] button').first()
      const advBefore = await advanced.getAttribute('aria-expanded')
      await advanced.click()
      await sleep(250)
      const advAfter = await advanced.getAttribute('aria-expanded')
      record(
        'M7 折叠 aria-expanded（使用说明/高级设置）',
        before === 'false' && after === 'true' && advBefore === 'false' && advAfter === 'true',
        `usage ${before}→${after}; advanced ${advBefore}→${advAfter}`,
      )
      await usage.click()
      await advanced.click()
      await sleep(200)
    } catch (e) {
      record('M7 折叠 aria-expanded（使用说明/高级设置）', false, String(e.message ?? e))
    }

    // ---- M5 逐路由无横向溢出 ----
    const routes = [
      { id: 'popup', title: '自动弹窗', twoCol: true },
      { id: 'msg', title: '自动发言', twoCol: true },
      { id: 'reply', title: '自动回复', twoCol: false },
      { id: 'ai', title: 'AI 助手', twoCol: false },
      { id: 'set', title: '应用设置', twoCol: false },
    ]
    for (const r of routes) {
      try {
        await ctx.invoke('shell:railToggle', r.id)
        await waitFor(
          async () => {
            const t = await railEval(rail, () =>
              document.querySelector('[data-testid="page-title"]')?.textContent?.trim(),
            )
            return t === r.title ? t : null
          },
          20_000,
          `路由 ${r.title}`,
        )
        await sleep(400)
        const st = await railEval(rail, PANEL_STYLES)
        const noOverflow = st.scrollW !== null && st.scrollW <= st.clientW + 1
        record(
          `M5 路由「${r.title}」无横向溢出`,
          noOverflow,
          `scrollW=${st.scrollW} clientW=${st.clientW}`,
        )
        if (r.twoCol) {
          const cols = await railEval(rail, () => {
            const g = document.querySelector('[data-testid="auto-grid"]')
            if (!g) return null
            const tracks = getComputedStyle(g)
              .gridTemplateColumns.split(' ')
              .map(v => Number.parseFloat(v))
            return { tracks, rectWidth: g.getBoundingClientRect().width }
          })
          // C5 回退（实测）：600 面板内两列内容不足（弹窗设置卡溢出/开关压字）→ 面板内单列
          record(
            `M3 路由「${r.title}」面板内单列回退（600 宽内容不足）`,
            Boolean(cols) && cols.tracks.length === 1,
            JSON.stringify(cols),
          )
        }
        if (r.id === 'popup') await ctx.captureContainer('panel-density-popup.png')
        if (r.id === 'set') {
          const layout = await railEval(rail, () => {
            const el = document.querySelector('[data-testid="settings-layout"]')
            if (!el) return null
            return {
              columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
              width: el.getBoundingClientRect().width,
            }
          })
          record(
            'M5 设置页两栏（目录+内容）',
            Boolean(layout) && layout.columns === 2,
            JSON.stringify(layout),
          )
        }
      } catch (e) {
        record(`M5 路由「${r.title}」无横向溢出`, false, String(e.message ?? e))
      }
    }

    // ---- M11 面板页头分层（600 宽标题不被操作区压成竖排）----
    try {
      await ctx.invoke('shell:railToggle', 'ai')
      await waitFor(
        async () => {
          const t = await railEval(rail, () =>
            document.querySelector('[data-testid="page-title"]')?.textContent?.trim(),
          )
          return t === 'AI 助手' ? t : null
        },
        20_000,
        'AI 助手页',
      )
      await sleep(400)
      const title = await waitFor(
        () =>
          railEval(rail, () => {
            const t = document.querySelector('[data-testid="page-title"]')
            const a = document.querySelector('[data-testid="page-actions"]')
            if (!t) return null
            const tr = t.getBoundingClientRect()
            const ar = a ? a.getBoundingClientRect() : null
            return {
              title: t.textContent?.trim(),
              titleW: tr.width,
              titleH: tr.height,
              actionsTop: ar?.top ?? null,
              actionsW: ar?.width ?? null,
              titleTop: tr.top,
            }
          }),
        5000,
        'AI 助手页头',
      )
      record(
        'M11 AI 助手页头分层（标题横向/操作区换行不挤压）',
        Boolean(title) &&
          (title.titleW ?? 0) >= 100 &&
          (title.titleH ?? 0) <= 40 &&
          title.actionsTop !== null &&
          title.actionsTop >= title.titleTop &&
          (title.actionsW ?? 0) > 0,
        JSON.stringify(title),
      )
      await ctx.captureContainer('panel-density-ai.png')
    } catch (e) {
      record('M11 AI 助手页头分层（标题横向/操作区换行不挤压）', false, String(e.message ?? e))
    }

    // ---- M6 面板内弹窗居中（Portal/fixed 包含块）----
    try {
      const d0 = await ctx.debug()
      if (!d0.panelOpen || d0.routeId !== 'ai') await ctx.invoke('shell:railToggle', 'ai')
      await waitFor(
        async () => {
          const t = await railEval(rail, () =>
            document.querySelector('[data-testid="page-title"]')?.textContent?.trim(),
          )
          return t === 'AI 助手' ? t : null
        },
        20_000,
        'AI 助手页',
      )
      await rail.locator('text=配置 API Key').first().click()
      const rect = await waitFor(
        () =>
          railEval(rail, () => {
            const d = document.querySelector('[data-slot="dialog-content"]')
            const o = document.querySelector('[data-slot="dialog-overlay"]')
            if (!d) return null
            const r = d.getBoundingClientRect()
            const or = o ? o.getBoundingClientRect() : null
            return {
              cx: r.x + r.width / 2,
              cy: r.y + r.height / 2,
              vw: window.innerWidth,
              vh: window.innerHeight,
              overlay: or ? { x: or.x, y: or.y, w: or.width, h: or.height } : null,
              padding: getComputedStyle(d).paddingTop,
            }
          }),
        8000,
        '弹窗出现',
      )
      const dx = Math.abs(rect.cx - rect.vw / 2)
      const dy = Math.abs(rect.cy - rect.vh / 2)
      const overlayOk =
        Boolean(rect.overlay) && rect.overlay.w >= rect.vw - 1 && rect.overlay.h >= rect.vh - 1
      record(
        'M6 弹窗居中（Portal/fixed 包含块）',
        dx <= 2 && dy <= 2 && overlayOk,
        `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} overlay=${JSON.stringify(rect.overlay)} padding=${rect.padding}`,
      )
      await rail.keyboard.press('Escape')
      await sleep(300)
      // ShellRail 的 ESC 同时会收起面板（既有交互）；重新打开以便后续宽度断言
      const reopened = await ctx.debug()
      if (!reopened.panelOpen) await ctx.invoke('shell:railToggle', 'live')
      await sleep(400)
    } catch (e) {
      record('M6 弹窗居中（Portal/fixed 包含块）', false, String(e.message ?? e))
    }

    // ---- M4 面板宽度 / 页面可见宽度（1280 / 1024 两档）----
    try {
      const d = await ctx.debug()
      const visible = d.windowWidth - d.railWidth
      record(
        'M4a 面板宽度与可见宽度（1280 窗）',
        d.railWidth === expectPanelW && visible > 0,
        `window=${d.windowWidth} rail=${d.railWidth} visible=${visible}`,
      )
      await ctx.app.evaluate(({ BrowserWindow }) => {
        const w =
          BrowserWindow.getAllWindows().find(x => x.contentView.children.length > 0) ??
          BrowserWindow.getAllWindows()[0]
        w.setSize(1024, 800)
      })
      await sleep(500)
      const d1024 = await ctx.debug()
      record(
        'M4b 最小窗（1024）面板 600/可见宽度',
        d1024.windowWidth === 1024 && d1024.railWidth === expectPanelW,
        `window=${d1024.windowWidth} rail=${d1024.railWidth} visible=${d1024.windowWidth - d1024.railWidth}`,
      )
      // ---- M9 minWidth 钳制 ----
      await ctx.app.evaluate(({ BrowserWindow }) => {
        const w =
          BrowserWindow.getAllWindows().find(x => x.contentView.children.length > 0) ??
          BrowserWindow.getAllWindows()[0]
        w.setSize(900, 700)
      })
      await sleep(500)
      const clamped = await ctx.debug()
      record(
        'M9 minWidth 钳制（setSize 900 → 实际 1024）',
        clamped.windowWidth === 1024,
        `actual=${clamped.windowWidth}`,
      )
    } catch (e) {
      record('M4 面板宽度/可见宽度', false, String(e.message ?? e))
    }

    // ---- M10 深色截图 ----
    try {
      await railEval(rail, () => document.documentElement.classList.add('dark'))
      await sleep(500)
      await ctx.captureContainer('panel-density-dark.png')
      record('M10 暗色面板截图', true, 'panel-density-dark.png')
    } catch (e) {
      record('M10 暗色面板截图', false, String(e.message ?? e))
    }
  } finally {
    await teardown(ctx)
  }

  // ---- M8 经典模式零变化 ----
  let classic = null
  try {
    classic = await launch(classicProfile, false)
    const page = classic.win
    await page.waitForLoadState().catch(() => {})
    await page.waitForSelector('[data-testid="status-card"]', { timeout: 20_000 }).catch(() => {})
    const st = await waitFor(
      async () => {
        const r = await page.evaluate(() => {
          const card = document.querySelector(
            '[data-testid="status-card"] [data-slot="card-content"]',
          )
          const title = document.querySelector('[data-testid="page-title"]')
          return {
            cardPadding: card ? getComputedStyle(card).paddingLeft : null,
            titleFont: title ? getComputedStyle(title).fontSize : null,
          }
        })
        return r.cardPadding ? r : null
      },
      20_000,
      '经典页 LiveControl',
    )
    const urls = classic.pages().map(p => p.url())
    const noShellViews = !urls.some(u => /(notice|entry|chrome|rail)\.html/.test(u))
    const png = await classic.app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return Array.from((await w.webContents.capturePage()).toPNG())
    })
    writeFileSync(path.join(outDir, 'panel-classic.png'), Buffer.from(png))
    record(
      'M8 经典模式零变化（Card 24px / 标题 20px / 无壳视图）',
      st.cardPadding === '24px' && st.titleFont === '20px' && noShellViews,
      `card=${st.cardPadding} title=${st.titleFont} noShellViews=${noShellViews}`,
    )
  } catch (e) {
    record('M8 经典模式零变化（Card 24px / 标题 20px / 无壳视图）', false, String(e.message ?? e))
  } finally {
    await teardown(classic)
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n== 面板密度 E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => {
  console.error('E2E 运行失败：', e)
  process.exit(1)
})
