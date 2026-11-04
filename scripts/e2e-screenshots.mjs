// E2E 截图验收（TC-13/14）：遍历 8 个路由 × 浅/深两套主题截图。
// 断言（用户已确认口径，2026-11-04）：
//   F4 横向溢出——根级 scrollWidth + overflow-x:auto/scroll 容器枚举，违规计入退出码；
//   F6 主题持久化（TC-13）——reload 后 .dark 类保持。
// 前置：应用已以 remote-debugging-port 9222 启动（pnpm dev 自带；生产模式亦然）。
// 运行：node scripts/e2e-screenshots.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'preview', 'ui-refactor-v2', 'shots')

const ROUTES = [
  ['zhongkongtai', '#/'],
  ['zidongfayan', '#/auto-message'],
  ['zidongtanchuang', '#/auto-popup'],
  ['zidonghuifu', '#/auto-reply'],
  ['huifushezhi', '#/auto-reply/settings'],
  ['yingyongshezhi', '#/settings'],
  ['aizhushou', '#/ai-chat'],
  ['hongbao', '#/red-packet'],
]

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
if (!context) throw new Error('未找到浏览器上下文')
const page = context.pages()[0] ?? (await context.newPage())

fs.mkdirSync(outDir, { recursive: true })

let failed = 0

// F4：横向溢出几何断言（根级 + 滚动容器枚举）
const assertNoHorizontalOverflow = async routeName => {
  const problems = await page.evaluate(() => {
    const found = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth + 1) {
      found.push(`[root] scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}`)
    }
    for (const el of document.querySelectorAll('div')) {
      const overflowX = getComputedStyle(el).overflowX
      if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2) {
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
  page.evaluate(m => {
    localStorage.setItem('appearance-storage', JSON.stringify({ state: { mode: m }, version: 1 }))
    document.documentElement.classList.toggle('dark', m === 'dark')
  }, mode)

const shot = async theme => {
  for (const [name, hash] of ROUTES) {
    await page.evaluate(h => {
      location.hash = h
    }, hash)
    await page.waitForTimeout(700)
    await assertNoHorizontalOverflow(name)
    await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) })
  }
}

await setTheme('light')
await shot('light')
await setTheme('dark')
await shot('dark')

// F6 / TC-13：主题持久化——reload 后 .dark 保持
await page.reload()
await page.waitForTimeout(1200)
const persistedDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
if (persistedDark) {
  console.log('✓ TC-13 主题持久化：reload 后深色保持')
} else {
  failed += 1
  console.error('✗ TC-13 主题持久化：reload 后深色丢失')
}

await setTheme('light')

const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'))
console.log(`✓ 截图完成：${files.length} 张 → ${outDir}`)
if (failed > 0) {
  console.error(`✗ 断言失败 ${failed} 项`)
  process.exitCode = 1
}
