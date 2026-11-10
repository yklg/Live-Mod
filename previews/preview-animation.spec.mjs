/**
 * Live Mod 预览 · 内容框进出动效验收（Playwright / 本机 Chrome）
 *
 * 运行（仓库根目录）：
 *   node previews/preview-animation.spec.mjs
 *
 * 覆盖计划 V1–V16 与测试评估件 AM-E01~E16 / AM-I02 的核心断言。
 * 只读：不改预览 HTML、不改生产源码；无外链、无真实数据。
 * 判据口径（R10a）：一律元素级 getAnimations()，按 animationName 前缀 lm- 与 playState 过滤。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HTML = path.join(ROOT, 'previews/live-mod-shell-v3-preview.html')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const raw = fs.readFileSync(HTML, 'utf8')

const results = []
const check = (id, name, ok, detail) => {
  results.push({ id, name, ok: !!ok, detail: detail || '' })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? '  → ' + detail : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const twoFrames = page =>
  page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const lmAnims = (page, selector, state) =>
  page.evaluate(
    ({ sel, st }) => {
      const el = document.querySelector(sel)
      if (!el) return []
      return el
        .getAnimations()
        .map(a => ({
          name: a.animationName || (a.effect && a.effect.getKeyframes ? 'unknown' : ''),
          playState: a.playState,
          duration: a.effect ? a.effect.getTiming().duration : null,
          easing: a.effect ? a.effect.getTiming().easing : '',
        }))
        .filter(x => x.name && x.name.startsWith('lm-') && (!st || x.playState === st))
    },
    { sel: selector, st: state || '' },
  )
const goto = async (page, id) => {
  await page.evaluate(x => {
    location.hash = '#/' + x
  }, id)
  await sleep(180)
}
const gotoCompare = async page => {
  await page.evaluate(() => {
    location.hash = '#/compare'
  })
  await sleep(220)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const warns = []
page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 160)))
page.on('console', m => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160))
  if (m.type() === 'warning') warns.push(m.text())
})
page.on('request', r => {
  if (/^https?:/.test(r.url()) && !r.url().includes('127.0.0.1'))
    errors.push('external: ' + r.url())
})

try {
  await page.goto(pathToFileURL(HTML).href, { waitUntil: 'domcontentloaded' })
  await sleep(350)

  // ---- 地基（🟢 特征化绿） ----
  check(
    'G0',
    '5 页导航可达 / 0 运行时错误',
    (await page.locator('#menu .menu-item').count()) === 5 && errors.length === 0,
    `menu=${await page.locator('#menu .menu-item').count()} errors=${errors.length}`,
  )
  check(
    'G1',
    'boot-fallback 已移除且 STORE/onerror/try-catch 仍在',
    await page.evaluate(
      () =>
        !document.getElementById('boot-fallback') &&
        typeof STORE === 'object' &&
        typeof MOTION === 'object' &&
        document.getElementById('anim-layer') !== null,
    ),
  )

  // ---- V1：菜单出现动画参数 ----
  await page.locator('#launch-after').click()
  await twoFrames(page)
  const inMenu = await lmAnims(page, '#menu-demo')
  const menuEasing = await page.evaluate(() => {
    const el = document.querySelector('#menu-demo')
    return el ? getComputedStyle(el).animationTimingFunction : ''
  })
  check(
    'V1',
    '菜单 lm-in / 180ms / 标准曲线',
    inMenu.some(a => a.name === 'lm-in' && a.duration === 180) &&
      menuEasing.includes('cubic-bezier') &&
      menuEasing.includes('0.2'),
    `anims=${JSON.stringify(inMenu.slice(0, 2))} timing=${menuEasing}`,
  )

  // ---- V9：菜单离场与面板进入重叠 ----
  await page.locator('#menu-demo [data-item="interaction"]').click()
  await twoFrames(page)
  const overlap = await page.evaluate(() => ({
    ghost: !!document.querySelector('#anim-layer > .railmenu.is-closing'),
    entering: !!document.querySelector('#view .floatpanel.is-entering'),
  }))
  check(
    'V9',
    '菜单残影与面板出现同时存在（重叠 180ms）',
    overlap.ghost && overlap.entering,
    JSON.stringify(overlap),
  )
  const inPanel = await lmAnims(page, '#panel-demo')
  check(
    'V2a',
    '浮层面板 lm-in',
    inPanel.some(a => a.name === 'lm-in'),
    JSON.stringify(inPanel.slice(0, 1)),
  )

  // ---- V3：残影属性 + 200ms 清理 ----
  await page.locator('#win-after [data-act="panel-close"]').click()
  const ghostInfo = await page.evaluate(() => {
    const g = document.querySelector('#anim-layer > .floatpanel.is-closing')
    if (!g) return null
    return {
      ghostAttr: g.hasAttribute('data-anim-ghost'),
      pointer: getComputedStyle(g).pointerEvents,
      hidden: g.getAttribute('aria-hidden'),
      batch: g.getAttribute('data-anim-batch'),
    }
  })
  check(
    'V3a',
    '残影带 ghost 标记 / pointer-events:none / aria-hidden',
    ghostInfo && ghostInfo.ghostAttr && ghostInfo.pointer === 'none' && ghostInfo.hidden === 'true',
    JSON.stringify(ghostInfo),
  )
  await sleep(240)
  const cleared = await page.evaluate(
    () => document.querySelectorAll('#anim-layer > .is-closing').length,
  )
  check('V3b', '200ms 后残影清理', cleared === 0, `left=${cleared}`)

  // ---- V6 / V6b：ESC 连按不堆积 ----
  await gotoCompare(page)
  await page.evaluate(() => {
    UI.after.menuOpen = false
    UI.after.panelOpen = false
    UI.after.routeId = null
    UI.after.restoreRoute = null
    UI.panel.menuOpen = false
    UI.panel.panelOpen = false
    route()
  })
  await sleep(80)
  await page.locator('#launch-after').click()
  await sleep(60)
  await page.keyboard.press('Escape') // 第一次：收起菜单，产生 1 个残影
  await sleep(260) // 等该批清理
  const afterClean = await page.evaluate(
    () => document.getElementById('anim-layer').children.length,
  )
  await page.keyboard.press('Escape') // 已无内容框可收起：不应再摘出
  await page.keyboard.press('Escape')
  const reentry = await page.evaluate(() => {
    const nodes = [...document.getElementById('anim-layer').children]
    const batches = nodes.map(n => n.getAttribute('data-anim-batch'))
    return { count: nodes.length, dupBatches: batches.length !== new Set(batches).size }
  })
  check(
    'V6b',
    '残影清理后连按 ESC 不产生新残影 / 无重复 batch',
    afterClean === 0 && reentry.count === 0 && !reentry.dupBatches,
    `afterClean=${afterClean} reentry=${JSON.stringify(reentry)}`,
  )
  check(
    'V6',
    'ESC 连按后无残影、无面板、无 JS 错误',
    (await page.locator('#anim-layer > .is-closing').count()) === 0 &&
      (await page.locator('#view .floatpanel').count()) === 0 &&
      errors.length === 0,
    `errors=${errors.length}`,
  )

  // ---- V8：compare 左 dock 不被重播（R9 fill:backwards） ----
  await gotoCompare(page)
  await sleep(260)
  const leftDock = await page.evaluate(() => {
    const el = document.querySelector('#win-before .dockpanel')
    if (!el) return { missing: true }
    return {
      entering: el.classList.contains('is-entering'),
      anims: el.getAnimations().filter(a => (a.animationName || '').startsWith('lm-')).length,
    }
  })
  check(
    'V8',
    '左侧 dock 无 lm- 动画（含 finished）',
    !leftDock.missing && leftDock.anims === 0,
    JSON.stringify(leftDock),
  )

  // ---- V2b / V2c：改动前 dock 也播出现动画 ----
  // compare 页刻意固定展示左侧 dock（每次 route 都会把 UI.before.panelOpen 设回 true），
  // 因此不能用 #launch-before 的 toggle 制造「重新打开」。改为 reload 后首屏读取新增框的 lm-in。
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(30)
  await twoFrames(page)
  const dockAnim = await lmAnims(page, '#dock-before')
  check(
    'V2b',
    '改动前 dock 首屏 lm-in（固定展示语义）',
    dockAnim.some(a => a.name === 'lm-in'),
    JSON.stringify(dockAnim.slice(0, 1)),
  )

  // ---- V5：keyframes 镜像 ----
  const mirror = await page.evaluate(() => {
    const find = name =>
      [...document.styleSheets]
        .flatMap(s => {
          try {
            return [...s.cssRules]
          } catch (e) {
            return []
          }
        })
        .find(r => r.type === CSSRule.KEYFRAMES_RULE && r.name === name)
    if (!find('lm-in') || !find('lm-out')) return false
    const a = [...find('lm-in').cssRules].map(r => r.keyText).join('|')
    const b = [...find('lm-out').cssRules].map(r => r.keyText).join('|')
    return a === '0%|100%' && b === '0%|100%'
  })
  check('V5', 'lm-in / lm-out keyframes 结构镜像', mirror)

  // ---- V7：导航 / 控制台路径不误触 ----
  await goto(page, 'menu')
  await goto(page, 'panel')
  await goto(page, 'connect')
  await gotoCompare(page)
  check(
    'V7',
    '页面导航后 #anim-layer 为空',
    (await page.evaluate(() => document.getElementById('anim-layer').children.length)) === 0,
  )

  // ---- V10：静态展示框不被摘出 ----
  await goto(page, 'menu')
  const staticBefore = await page.locator('#menu-demo[data-static]').count()
  await page.locator('#tm-esc').click()
  const staticAfter = await page.locator('#menu-demo[data-static]').count()
  check(
    'V10',
    'menu 页静态框未被摘出',
    staticBefore === 1 &&
      staticAfter === 1 &&
      (await page.evaluate(() => document.getElementById('anim-layer').children.length)) === 0,
  )

  // ---- V14：验收面板动效说明可见 ----
  await page.locator('#btn-accept').click()
  check('V14', '#motion-accept-hint 可见', await page.locator('#motion-accept-hint').isVisible())
  await page.locator('#acc-close').click()

  // ---- V13：行为断言——预置残影不被二次摘出 ----
  await gotoCompare(page)
  await page.locator('#launch-after').click()
  await sleep(60)
  await page.evaluate(() => {
    const layer = document.getElementById('anim-layer')
    const g = document.createElement('div')
    g.className = 'railmenu is-closing'
    g.setAttribute('data-anim-ghost', '')
    g.setAttribute('data-anim-batch', 'pre-seeded')
    g.style.cssText = 'position:fixed;left:8px;top:8px;width:80px;height:80px'
    layer.appendChild(g)
  })
  await page.keyboard.press('Escape')
  const seeded = await page.evaluate(() => {
    const g = document.querySelector('#anim-layer [data-anim-batch="pre-seeded"]')
    return {
      exists: !!g,
      batch: g && g.getAttribute('data-anim-batch'),
      ghost: g && g.hasAttribute('data-anim-ghost'),
    }
  })
  check(
    'V13',
    '预置残影未被二次摘出 / batch 未覆盖',
    seeded.exists && seeded.batch === 'pre-seeded' && seeded.ghost,
    JSON.stringify(seeded),
  )
  await page.evaluate(() => {
    ;[...document.querySelectorAll('#anim-layer > *')].forEach(n => {
      n.remove()
    })
  })
  await sleep(220)

  // ---- V15：失败分档通道（汇总上报） ----
  await gotoCompare(page)
  await page.locator('#launch-after').click()
  await sleep(50)
  await page.evaluate(() => {
    const layer = document.getElementById('anim-layer')
    for (let i = 0; i < 2; i++) {
      const g = document.createElement('div')
      g.className = 'railmenu is-closing'
      g.setAttribute('data-anim-ghost', '')
      g.style.cssText = 'position:fixed;left:8px;top:8px;width:60px;height:60px'
      layer.appendChild(g)
    }
  })
  warns.length = 0
  await page.keyboard.press('Escape')
  await sleep(240)
  check(
    'V15',
    '残影堆积触发 console.warn 汇总上报',
    warns.some(w => w.includes('[motion] 残影堆积')),
    warns.slice(-1).join(''),
  )
  await page.evaluate(() => {
    ;[...document.querySelectorAll('#anim-layer > *')].forEach(n => {
      n.remove()
    })
  })

  // ---- V4 + V16 + AM-E12/14/15：reduced-motion ----
  const rmPage = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: 'reduce',
  })
  const rmErrors = []
  rmPage.on('pageerror', e => rmErrors.push(String(e)))
  await rmPage.goto(pathToFileURL(HTML).href, { waitUntil: 'domcontentloaded' })
  await sleep(300)
  await rmPage.locator('#launch-after').click()
  await twoFrames(rmPage)
  const rmMenuAnims = await lmAnims(rmPage, '#menu-demo', 'running')
  check(
    'V4a',
    'reduce：菜单无 running 的 lm- 动画',
    rmMenuAnims.length === 0,
    JSON.stringify(rmMenuAnims),
  )
  const timerBase = await rmPage.evaluate(() => MOTION.ghostTimers)
  await rmPage.keyboard.press('Escape')
  const timerAfter = await rmPage.evaluate(() => MOTION.ghostTimers)
  const rmState = await rmPage.evaluate(() => ({
    ghosts: document.querySelectorAll('#anim-layer > .is-closing').length,
    closing: document.querySelectorAll('.is-closing').length,
    fallback: document.documentElement.getAttribute('data-motion-fallback'),
  }))
  check(
    'V4b',
    'reduce：ghostTimers 增量 0 / 零残影 / 有降级标记',
    timerAfter - timerBase === 0 &&
      rmState.ghosts === 0 &&
      rmState.closing === 0 &&
      rmState.fallback === 'reduce',
    JSON.stringify({ delta: timerAfter - timerBase, ...rmState }),
  )

  // V16：reduced-motion 下最终状态不丢信息
  await rmPage.locator('#launch-after').click()
  await rmPage.locator('#menu-demo [data-item="interaction"]').click()
  await sleep(80)
  const finalState = await rmPage.evaluate(() => {
    const el = document.querySelector('#view .floatpanel')
    if (!el) return null
    const cs = getComputedStyle(el)
    const btn = el.querySelector('button')
    return {
      opacity: cs.opacity,
      text: (el.innerText || '').trim().length,
      clickable: !!btn && cs.pointerEvents !== 'none',
    }
  })
  check(
    'V16',
    'reduce：面板最终状态完整可见可点',
    finalState && finalState.opacity === '1' && finalState.text > 10 && finalState.clickable,
    JSON.stringify(finalState),
  )

  // AM-E15：break-it-on-purpose —— 故意让 reduced() 返回 false，V4 应失效
  await rmPage.evaluate(() => {
    MOTION.reduced = () => false
  })
  await rmPage.locator('[data-act="panel-close"]').first().click()
  const broken = await rmPage.evaluate(
    () => document.querySelectorAll('#anim-layer > .is-closing').length,
  )
  check('V16b', '故意破坏 reduce 判定后残影出现（哨兵有效）', broken > 0, `ghosts=${broken}`)
  check('V4c', 'reduce 页 0 运行时错误', rmErrors.length === 0, JSON.stringify(rmErrors))
  await rmPage.close()

  // ---- V11：三环境 + 暗色 + 0 外链 + iframe matchMedia ----
  const dataPage = await browser.newPage()
  await dataPage.goto('data:text/html;charset=utf-8,' + encodeURIComponent(raw), {
    waitUntil: 'domcontentloaded',
  })
  await sleep(300)
  check(
    'V11a',
    'data: opaque origin 渲染正常（localStorage 被禁）',
    (await dataPage.locator('#menu .menu-item').count()) === 5,
  )
  await dataPage.close()

  const sandboxPage = await browser.newPage()
  await sandboxPage.setContent(
    '<iframe id="f" sandbox="allow-scripts" style="width:1500px;height:950px;border:0"></iframe>',
  )
  await sandboxPage.evaluate(h => {
    document.getElementById('f').srcdoc = h
  }, raw)
  await sleep(500)
  const frame = sandboxPage.frames().find(f => f !== sandboxPage.mainFrame())
  const mm = frame
    ? await frame.evaluate(() => {
        try {
          return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'match' : 'no-preference'
        } catch (e) {
          return 'unsupported: ' + e.name
        }
      })
    : 'no-frame'
  check(
    'V11b',
    'sandbox iframe 内 matchMedia 可用且页面渲染',
    !!frame &&
      (await frame.locator('#menu .menu-item').count()) === 5 &&
      mm !== 'no-frame' &&
      !String(mm).startsWith('unsupported'),
    mm,
  )
  await sandboxPage.close()

  await page.locator('#btn-theme').click()
  check(
    'V11c',
    '暗色主题切换生效',
    (await page.locator('html').getAttribute('data-theme')) === 'dark',
  )
  check('V11d', '单文件 0 外链资源', !/<script[^>]+src=|<link[^>]+href=|url\(https?:\/\//.test(raw))

  // ---- V12：备份与人工加固完整性 ----
  const bkPath = fs.existsSync('/tmp/lm-preview-backup-latest')
    ? fs.readFileSync('/tmp/lm-preview-backup-latest', 'utf8').trim()
    : ''
  const bkFiles = bkPath && fs.existsSync(bkPath) ? fs.readdirSync(bkPath) : []
  const bkHtml = bkFiles.includes('live-mod-shell-v3-preview.html')
    ? fs.readFileSync(path.join(bkPath, 'live-mod-shell-v3-preview.html'), 'utf8')
    : ''
  check(
    'V12',
    '4 个备份文件存在且为改动前版本',
    bkFiles.length === 4 && bkHtml.length > 0 && !bkHtml.includes('withCloseAnimation'),
    `${bkPath} files=${bkFiles.length}`,
  )

  // ---- AM-I02：四处人工加固仍在 ----
  const guards = [
    'id="boot-fallback"',
    'const STORE=',
    "window.addEventListener('error'",
    'boot.remove()',
  ]
  check(
    'AM-I02',
    'boot-fallback / STORE / onerror / 末尾 try-catch 四处仍在',
    guards.every(g => raw.includes(g)),
    guards.filter(g => !raw.includes(g)).join(',') || 'all present',
  )
} catch (e) {
  check('FATAL', '脚本执行异常', false, String((e && e.stack) || e).slice(0, 300))
} finally {
  await browser.close()
}

const passed = results.filter(r => r.ok).length
const failed = results.filter(r => !r.ok)
console.log(`\n=== 汇总: ${passed}/${results.length} 通过, ${failed.length} 失败 ===`)
if (failed.length) console.log('失败项: ' + failed.map(f => f.id).join(', '))
console.log(`运行时错误: ${errors.length ? JSON.stringify(errors.slice(0, 5)) : 0}`)
process.exit(failed.length ? 1 : 0)
