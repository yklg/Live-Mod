#!/usr/bin/env node
/**
 * 纯 Node 软件光栅化图标生成器（零外部依赖，结果确定性可复现）。
 *
 * 背景：此前先后使用 qlmanage / Electron 离屏捕获 / Electron 页内 Canvas 三种
 * 外部渲染方案，分别踩到白底合成、透明窗口内容错位、img.decode() 挂死等
 * 环境相关问题。图标本质是简单几何图形的叠加，因此改为基于 SDF
 * （有向距离场）逐像素解析渲染，不依赖任何外部渲染器。
 *
 * 产物：
 *   1. public/favicon.png  512px 全出血（浏览器 favicon、侧栏、README）
 *   2. build/icon.png      1024px 画布、824px 画面（Apple 图标网格留白，mac 应用图标源，
 *                          electron-builder mac.icon 引用）
 *   3. public/favicon.ico  256/128/64/48/32/16 六档，每档独立矢量渲染（Windows 任务栏与安装包）
 *
 * 注意：几何数据须与 public/favicon.svg 保持同步（浏览器内 SVG 透明渲染正常，仍作 web 用途）。
 * 用法：node scripts/build-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pngPath = join(root, 'public', 'favicon.png')
const macIconPath = join(root, 'build', 'icon.png')
const icoPath = join(root, 'public', 'favicon.ico')
const ICO_SIZES = [256, 128, 64, 48, 32, 16]

// ===================== 设计定义（512 设计空间，与 favicon.svg 同步） =====================
const DESIGN = 512
const DESIGN_RX = 115 // 背景圆角
// 线性渐变 #38BDF8 → #4F46E5（左上 → 右下）
const BG_FROM = [56, 189, 248]
const BG_TO = [79, 70, 229]
const COL = {
  windowStroke: [30, 58, 138], // #1E3A8A
  white: [255, 255, 255],
  red: [255, 59, 92], // #FF3B5C
  indigo: [79, 70, 229], // #4F46E5（播放键，与渐变终点一致）
  bar1: [199, 210, 254], // #C7D2FE
  bar2: [253, 229, 138], // #FDE68A
  yellow: [255, 197, 61], // #FFC53D
}
// 直播窗口（含 14px 描边）：x 88..424, y 120..380, rx 56
const WINDOW = { cx: 256, cy: 250, hw: 168, hh: 130, r: 56, strokeHalf: 7 }
// LIVE 胶囊：x 114..198, y 146..180（全圆角 = 半高 17）
const LIVE_PILL = { cx: 156, cy: 163, hw: 42, hh: 17, r: 17 }
const LIVE_DOT = { cx: 134, cy: 163, r: 8 }
// 播放三角（stroke 20 圆角连接 = 外扩 10）
const PLAY = [
  [210, 196],
  [306, 248],
  [210, 300],
]
const PLAY_ROUND = 10
// 弹幕条
const BAR1 = { cx: 199, cy: 334, hw: 69, hh: 10, r: 10 }
const BAR2 = { cx: 181, cy: 358, hw: 51, hh: 10, r: 10 }
// 闪电多边形（白色 16px 描边 = ±8）
const BOLT = [
  [392, 288],
  [330, 372],
  [368, 372],
  [344, 442],
  [420, 346],
  [378, 346],
  [408, 288],
]
const BOLT_STROKE_HALF = 8

// ===================== SDF（有向距离场，设计空间） =====================
function sdRoundRect(x, y, s) {
  const dx = Math.abs(x - s.cx) - (s.hw - s.r)
  const dy = Math.abs(y - s.cy) - (s.hh - s.r)
  const ax = dx > 0 ? dx : 0
  const ay = dy > 0 ? dy : 0
  const outer = Math.sqrt(ax * ax + ay * ay)
  const inner = Math.min(Math.max(dx, dy), 0)
  return outer + inner - s.r
}

function sdCircle(x, y, s) {
  const dx = x - s.cx
  const dy = y - s.cy
  return Math.sqrt(dx * dx + dy * dy) - s.r
}

function sdPoly(x, y, pts) {
  const n = pts.length
  let d2 = Number.POSITIVE_INFINITY
  let sign = 1
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[j][0]
    const ay = pts[j][1]
    const bx = pts[i][0]
    const by = pts[i][1]
    const ex = bx - ax
    const ey = by - ay
    const wx = x - ax
    const wy = y - ay
    const ee = ex * ex + ey * ey
    const t = ee > 0 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / ee)) : 0
    const dx = x - (ax + t * ex)
    const dy = y - (ay + t * ey)
    const dd = dx * dx + dy * dy
    if (dd < d2) d2 = dd
    const c1 = y >= ay
    const c2 = y < by
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign
  }
  return sign * Math.sqrt(d2)
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)

// ===================== 渲染 =====================
function renderIcon(size, artSize) {
  const scale = artSize / DESIGN
  const margin = (size - artSize) / 2
  const data = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // 像素中心 → 设计空间坐标
      const x = (px + 0.5 - margin) / scale
      const y = (py + 0.5 - margin) / scale
      // 背景圆角矩形（抗锯齿覆盖度，SDF 换算回输出像素空间）
      const bgSd = sdRoundRect(x, y, { cx: 256, cy: 256, hw: 256, hh: 256, r: DESIGN_RX }) * scale
      const bgCov = clamp01(0.5 - bgSd)
      const o = (py * size + px) * 4
      if (bgCov <= 0) continue // 圆角外保持透明
      // 对角线线性渐变
      const t = clamp01((x + y) / (2 * DESIGN))
      let r = BG_FROM[0] + (BG_TO[0] - BG_FROM[0]) * t
      let g = BG_FROM[1] + (BG_TO[1] - BG_FROM[1]) * t
      let b = BG_FROM[2] + (BG_TO[2] - BG_FROM[2]) * t
      // 依次叠加图层（painter's order）
      const win = sdRoundRect(x, y, WINDOW) * scale
      const strokeCov = clamp01(0.5 - (Math.abs(win) - WINDOW.strokeHalf))
      if (strokeCov > 0) {
        r += (COL.windowStroke[0] - r) * strokeCov
        g += (COL.windowStroke[1] - g) * strokeCov
        b += (COL.windowStroke[2] - b) * strokeCov
      }
      const layers = [
        [COL.white, win],
        [COL.red, sdRoundRect(x, y, LIVE_PILL) * scale],
        [COL.white, sdCircle(x, y, LIVE_DOT) * scale],
        [COL.indigo, (sdPoly(x, y, PLAY) - PLAY_ROUND) * scale],
        [COL.bar1, sdRoundRect(x, y, BAR1) * scale],
        [COL.bar2, sdRoundRect(x, y, BAR2) * scale],
      ]
      for (const [col, sd] of layers) {
        const cov = clamp01(0.5 - sd)
        if (cov > 0) {
          r += (col[0] - r) * cov
          g += (col[1] - g) * cov
          b += (col[2] - b) * cov
        }
      }
      const bolt = sdPoly(x, y, BOLT) * scale
      const boltStrokeCov = clamp01(0.5 - (Math.abs(bolt) - BOLT_STROKE_HALF))
      if (boltStrokeCov > 0) {
        r += (COL.white[0] - r) * boltStrokeCov
        g += (COL.white[1] - g) * boltStrokeCov
        b += (COL.white[2] - b) * boltStrokeCov
      }
      const boltFillCov = clamp01(0.5 - bolt)
      if (boltFillCov > 0) {
        r += (COL.yellow[0] - r) * boltFillCov
        g += (COL.yellow[1] - g) * boltFillCov
        b += (COL.yellow[2] - b) * boltFillCov
      }
      data[o] = Math.round(r)
      data[o + 1] = Math.round(g)
      data[o + 2] = Math.round(b)
      data[o + 3] = Math.round(bgCov * 255)
    }
  }
  return { width: size, height: size, data }
}

// ===================== PNG 编码（RGBA 8-bit，filter 0） =====================
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(image) {
  const { width, height, data } = image
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ===================== ICO 打包（PNG-in-ICO） =====================
function encodeICO(pngBuffers) {
  const sizes = [...pngBuffers.keys()]
  const entries = []
  const chunks = []
  let offset = 6 + 16 * sizes.length
  for (const size of sizes) {
    const data = pngBuffers.get(size)
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
  dir.writeUInt16LE(sizes.length, 4)
  return Buffer.concat([dir, ...entries, ...chunks])
}

// ===================== 自检：四角必须透明 =====================
function assertTransparentCorners(pngPath) {
  const buf = readFileSync(pngPath)
  let pos = 8
  const idat = []
  let width = 0
  let height = 0
  let colorType = 6
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.slice(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    pos += 12 + len
  }
  if (colorType !== 6) throw new Error(`${pngPath} 不是 RGBA PNG (colorType=${colorType})`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const cur = out.slice(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0
      const b = prev[x]
      const c = x >= 4 ? prev[x - 4] : 0
      let v = row[x]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + b) & 255
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      cur[x] = v
    }
  }
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]
  for (const [x, y] of corners) {
    const alpha = out[y * stride + x * 4 + 3]
    if (alpha !== 0) throw new Error(`${pngPath} 角 (${x},${y}) alpha=${alpha}，不是透明背景！`)
  }
}

// ===================== 主流程 =====================
mkdirSync(dirname(macIconPath), { recursive: true })

writeFileSync(pngPath, encodePNG(renderIcon(512, 512)))
writeFileSync(macIconPath, encodePNG(renderIcon(1024, 824)))
assertTransparentCorners(pngPath)
assertTransparentCorners(macIconPath)

const icoBuffers = new Map()
for (const size of ICO_SIZES) {
  icoBuffers.set(size, encodePNG(renderIcon(size, size)))
}
writeFileSync(icoPath, encodeICO(icoBuffers))

console.log(
  `✓ favicon.png（512 全出血）+ build/icon.png（1024/824 留白）+ favicon.ico（${ICO_SIZES.join('/')}）已生成，四角透明自检通过`,
)
