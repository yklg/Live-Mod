#!/usr/bin/env node
/**
 * 从 public/favicon.svg 生成 favicon.png（512px，mac 图标）与多尺寸 favicon.ico（Windows 图标）。
 *
 * 用法：node scripts/build-icons.mjs
 * 依赖：macOS 原生 qlmanage（SVG → PNG 栅格化）与 sips（缩放），零 npm 依赖。
 * ICO 采用 PNG-in-ICO 格式（Vista+ 标准），包含 256/128/64/48/32/16 六档尺寸，
 * 满足 electron-builder 对 Windows 图标「至少 256x256」的要求。
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'public', 'favicon.svg')
const pngPath = join(root, 'public', 'favicon.png')
const icoPath = join(root, 'public', 'favicon.ico')
// ICO 目录项的宽高字节最大只表达 256（0 表示 256），512 单独作为 favicon.png 提供
const ICO_SIZES = [256, 128, 64, 48, 32, 16]
const PNG_SIZE = 512

function run(cmd) {
  execSync(cmd, { stdio: 'pipe' })
}

// 1. SVG → PNG（qlmanage 输出文件名为 <name>.svg.png）
const tmp = mkdtempSync(join(tmpdir(), 'live-mod-icons-'))
try {
  run(`qlmanage -t -s ${PNG_SIZE} -o "${tmp}" "${svgPath}"`)
  const rendered = join(tmp, 'favicon.svg.png')
  run(`sips -s format png "${rendered}" --out "${pngPath}"`)

  // 2. 缩放出 ICO 各档尺寸
  const pngs = new Map()
  for (const size of ICO_SIZES) {
    const out = join(tmp, `icon-${size}.png`)
    run(`sips -z ${size} ${size} "${pngPath}" --out "${out}"`)
    pngs.set(size, readFileSync(out))
  }

  // 3. 打包 PNG-in-ICO：ICONDIR(6B) + N × ICONDIRENTRY(16B) + PNG 数据
  const entries = []
  const chunks = []
  let offset = 6 + 16 * ICO_SIZES.length
  for (const size of ICO_SIZES) {
    const data = pngs.get(size)
    const header = Buffer.alloc(16)
    const byte = size >= 256 ? 0 : size // 0 表示 256
    header.writeUInt8(byte, 0)
    header.writeUInt8(byte, 1)
    header.writeUInt8(0, 2) // 调色板色数（PNG 格式填 0）
    header.writeUInt8(0, 3) // 保留位
    header.writeUInt16LE(1, 4) // 颜色平面数
    header.writeUInt16LE(32, 6) // 位深
    header.writeUInt32LE(data.length, 8)
    header.writeUInt32LE(offset, 12)
    entries.push(header)
    chunks.push(data)
    offset += data.length
  }
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0) // 保留位
  dir.writeUInt16LE(1, 2) // 类型：1 = 图标
  dir.writeUInt16LE(ICO_SIZES.length, 4)
  writeFileSync(icoPath, Buffer.concat([dir, ...entries, ...chunks]))

  console.log(`✓ favicon.png（${PNG_SIZE}px）与 favicon.ico（${ICO_SIZES.join('/')}）已生成`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
