#!/usr/bin/env node
// 硬编码色检查：拦截组件内绕过设计令牌的调色板类与十六进制色（UI 重构 3.4 结构性防线）。
// 运行时机：pnpm pretest（以及需要时手动执行 node scripts/check-ui-tokens.mjs）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

// 例外：测试文件与 Markdown 主题 CSS（其令牌覆盖层本身合法）
const ALLOWED = [/\.test\.(ts|tsx)$/, /MessageContent\.css$/]

const CHECKS = [
  [
    'palette-class',
    /(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret|placeholder)-(?:gray|zinc|neutral|stone|slate|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  ],
  ['bg-white', /\bbg-white\b/],
  ['text-black/white', /\btext-(?:black|white)\b/],
]
// tsx 内的十六进制色（CSS 变量覆盖层等场景在 .css/.ts 中不查）
const HEX = /['":\s]#[0-9a-fA-F]{3,8}\b/

function walkSync(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkSync(full, acc)
    else acc.push(full)
  }
  return acc
}

const offenders = []

for (const full of walkSync(srcDir)) {
  const rel = path.relative(root, full)
  if (!/\.(tsx|ts)$/.test(rel) || ALLOWED.some(pattern => pattern.test(rel))) continue

  const content = fs.readFileSync(full, 'utf8')
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    for (const [name, pattern] of CHECKS) {
      if (pattern.test(line)) {
        offenders.push(`${rel}:${index + 1} [${name}] ${line.trim().slice(0, 120)}`)
        return
      }
    }
    if (rel.endsWith('.tsx') && HEX.test(line)) {
      offenders.push(`${rel}:${index + 1} [hex] ${line.trim().slice(0, 120)}`)
    }
  })
}

if (offenders.length > 0) {
  console.error(
    `\n✗ 发现 ${offenders.length} 处硬编码颜色，请改用设计令牌（bg-background / text-muted-foreground / text-success ...）：\n`,
  )
  for (const item of offenders) console.error(`  ${item}`)
  console.error(
    '\n语义令牌：background/foreground/card/muted/primary/secondary/accent/destructive/success/warning/info/note/border/input/ring（支持 /透明度 修饰）。',
  )
  process.exit(1)
}

console.log('✓ 硬编码色检查通过（0 处违规）')
