// 构建产物断言（计划 v3 · TC-PD-11 / ART-CSS）：面板容器查询必须真正进入 CSS。
// 防「rail.html/TSX 里写了 @container/panel 但 Tailwind 未扫描 → 静默失效」。
// 用法：node scripts/check-container-css.mjs（需先 npx vite build）
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repo = path.resolve(import.meta.dirname, '..')
const assets = path.join(repo, 'dist/assets')
let files = []
try {
  files = readdirSync(assets).filter(f => f.endsWith('.css'))
} catch {
  console.error('[check-container-css] dist/assets 不存在：请先运行 npx vite build')
  process.exit(1)
}
if (files.length === 0) {
  console.error('[check-container-css] 未找到 CSS 产物')
  process.exit(1)
}
const css = files.map(f => readFileSync(path.join(assets, f), 'utf-8')).join('\n')
const needContainerType = /container-type\s*:\s*inline-size/.test(css)
const needAtContainer = /@container/.test(css)
const needEntry = /@container entry not \(min-width:760px\)/.test(css)
if (!needContainerType || !needAtContainer || !needEntry) {
  console.error(
    `[check-container-css] FAIL：container-type=${needContainerType} @container=${needAtContainer} entry=${needEntry}`,
  )
  console.error(
    '  可能原因：rail.html / entry.html 的 @container/panel|entry 未被 Tailwind 扫描，或变体未生成。',
  )
  process.exit(1)
}
console.log(
  `[check-container-css] PASS（${files.length} 个 CSS 文件：panel/entry 容器规则均已生成）`,
)
