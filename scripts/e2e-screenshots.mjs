// E2E 截图验收（TC-13/14）：壳右栏 8 条路由 × 浅/深两套主题截图。
// 断言（用户已确认口径，2026-11-04；2026-11-09 壳化后路由来源改为 shared/shellRoutes）：
//   F4 横向溢出——根级 scrollWidth + overflow-x:auto/scroll 容器枚举，违规计入退出码；
//   F6 主题持久化（TC-13）——reload 后 .dark 类保持。
// 前置：npx vite build（脚本自行启动 Electron，不再要求预先开 9222）。
// 运行：node scripts/e2e-screenshots.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.screenshots', 'shell-screens')

// 与 shared/shellRoutes.ts 对齐；AI 路由已退场（AI 只存在于全局浮窗，不在右栏）。
const ROUTES = [
  ['zhongkongtai', 'live', '直播控制台'],
  ['zidongtanchuang', 'popup', '自动弹窗'],
  ['zidongfayan', 'message', '自动发言'],
  ['zidonghuifu', 'reply', '自动回复'],
  ['huifushezhi', 'reply-settings', '自动回复设置'],
  ['zhibohudong', 'interaction', null],
  ['yingyongshezhi', 'settings', '应用设置'],
  ['hongbao', 'red-packet', '一键发红包'],
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

const app = await electron.launch({
  args: ['.', `--user-data-dir=/tmp/lm-e2e-screens-${Date.now()}`],
  cwd: root,
  env: { ...process.env, LM_SHELL_DEBUG: '1' },
  timeout: 30_000,
})

let failed = 0
try {
  const pageBy = needle =>
    (async () => {
      const end = Date.now() + 30_000
      while (Date.now() < end) {
        const p = app.windows().find(w => w.url().includes(needle))
        if (p) return p
        await sleep(150)
      }
      throw new Error(`等待超时：页面 ${needle}`)
    })()
  // 壳模式有 chrome/rail/entry 多个 WebContents：按 URL 精确取 rail，绝不抢 firstWindow/浮窗。
  const rail = await pageBy('rail.html')
  await rail.waitForLoadState().catch(() => {})
  fs.mkdirSync(outDir, { recursive: true })

  const openRoute = async (id, title) => {
    await rail.evaluate(routeId => window.ipcRenderer.invoke('shell:railToggle', routeId), id)
    if (title) {
      const end = Date.now() + 5000
      while (Date.now() < end) {
        const text = await rail
          .evaluate(() =>
            document.querySelector('[data-testid="panel-title"]')?.textContent?.trim(),
          )
          .catch(() => null)
        if (text === title) return
        await sleep(100)
      }
    }
    // 无 Page 标题的页面（直播互动）退化为内容稳定等待
    await sleep(700)
  }

  // F4：横向溢出几何断言（根级 + 滚动容器枚举）
  const assertNoHorizontalOverflow = async routeName => {
    const problems = await rail.evaluate(() => {
      const found = []
      const doc = document.documentElement
      if (doc.scrollWidth > doc.clientWidth + 1) {
        found.push(`[root] scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}`)
      }
      for (const el of document.querySelectorAll('div')) {
        const overflowX = getComputedStyle(el).overflowX
        if (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          el.scrollWidth > el.clientWidth + 2
        ) {
          const tag = el.className || el.id || 'div'
          found.push(
            `[container] ${String(tag).slice(0, 80)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
          )
        }
      }
      return found
    })
    if (problems.length > 0) {
      failed += problems.length
      console.error(`✗ [${routeName}] 横向溢出：`)
      for (const item of problems) console.error(`    ${item}`)
    }
  }

  const setTheme = mode =>
    rail.evaluate(m => {
      localStorage.setItem('appearance-storage', JSON.stringify({ state: { mode: m }, version: 1 }))
      document.documentElement.classList.toggle('dark', m === 'dark')
    }, mode)

  const shot = async theme => {
    for (const [name, id, title] of ROUTES) {
      await openRoute(id, title)
      await assertNoHorizontalOverflow(name)
      await rail.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) })
    }
  }

  await setTheme('light')
  await shot('light')
  await setTheme('dark')
  await shot('dark')

  // F6 / TC-13：主题持久化——reload 后 .dark 保持
  await rail.reload()
  await rail.waitForLoadState().catch(() => {})
  await sleep(1200)
  const persistedDark = await rail.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  )
  if (persistedDark) {
    console.log('✓ TC-13 主题持久化：reload 后深色保持')
  } else {
    failed += 1
    console.error('✗ TC-13 主题持久化：reload 后深色丢失')
  }

  await setTheme('light')

  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'))
  console.log(`✓ 截图完成：${files.length} 张 → ${outDir}`)
} catch (e) {
  failed += 1
  console.error(`✗ 截图脚本异常：${e.message}`)
} finally {
  await app.close().catch(() => {})
  try {
    app.process().kill('SIGKILL')
  } catch {}
}

if (failed > 0) {
  console.error(`✗ 断言失败 ${failed} 项`)
  process.exitCode = 1
}
