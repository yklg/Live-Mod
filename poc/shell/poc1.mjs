// POC — throwaway：PoC-1 自动部分（中控台确认 / 风控跳转监测 / CreepJS 指纹基线）
// 前置：壳窗口已完成人工登录
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const CDP = 'http://127.0.0.1:9222'
const HERE = dirname(fileURLToPath(import.meta.url))
const EV = join(HERE, 'evidence')
mkdirSync(EV, { recursive: true })
const results = []
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${name} — ${detail}`)
}

const NAV_RISK = /verify|captcha|slider|check|punish/i

async function main() {
  const b = await chromium.connectOverCDP(CDP)
  const shell = b
    .contexts()
    .flatMap(c => c.pages())
    .find(p => p.url().includes('jinritemai.com'))
  if (!shell) {
    record('1-entry', '壳窗口存在', false, '未找到 jinritemai target')
    return finish(b)
  }
  const homeUrl = shell.url()
  record('1-entry', '壳窗口存在（登录后）', true, homeUrl.slice(0, 90))

  // 风控跳转监测：全程监听 URL 变化
  const navs = []
  shell.on('framenavigated', f => f === shell.mainFrame() && navs.push(f.url()))

  // [1-control] 中控台加载：已离开登录页且标题/URL 命中中控台，页面有实际内容
  const title = await shell.title()
  const onControl = /control|中控/i.test(homeUrl + title) && !/\/login/i.test(homeUrl)
  const bodyLen = await shell.evaluate(() => document.body.innerText.length).catch(() => 0)
  await shell.screenshot({ path: join(EV, 'poc1-after-login.png') })
  record(
    '1-control',
    '中控台页面正常加载',
    onControl && bodyLen > 50,
    `title="${title}" bodyText=${bodyLen}字符 url=${homeUrl.slice(0, 60)}`,
  )

  // [1-creep] CreepJS 指纹基线（壳窗口自身，attach 保持连接 = 真实使用状态）
  await shell.goto('https://abrahamjuliot.github.io/creepjs/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  })
  await shell.waitForTimeout(20000)
  await shell.screenshot({ path: join(EV, 'poc1-creepjs.png'), fullPage: false })
  const creep = await shell
    .evaluate(() => {
      const txt = document.body.innerText
      // 精确匹配 “N% headless / N% stealth / N% like headless”，避免误取区块标题旁的 hash
      const trust = txt.match(/trust score[^\d]*([\d.]+%?)/i)?.[1]
      const headless = txt.match(/([\d.]+)%\s*headless/i)?.[1]
      const likeHeadless = txt.match(/([\d.]+)%\s*like headless/i)?.[1]
      const stealth = txt.match(/([\d.]+)%\s*stealth/i)?.[1]
      const wd = navigator.webdriver
      return {
        trust,
        headless,
        likeHeadless,
        stealth,
        wd: String(wd),
        ua: navigator.userAgent.slice(0, 80),
      }
    })
    .catch(e => ({ err: e.message.split('\n')[0] }))
  record('1-creep', 'CreepJS 基线采集', !creep.err, JSON.stringify(creep))

  // [1-back] 回跳中控台，二次导航无风控
  await shell.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await shell.waitForTimeout(6000)
  const riskNav = navs.filter(u => NAV_RISK.test(u))
  record(
    '1-risknav',
    '全程无风控/验证页跳转',
    riskNav.length === 0,
    riskNav.length ? riskNav.join(' | ') : `共 ${navs.length} 次导航，无 verify/captcha 命中`,
  )
  const relogin = await shell.evaluate(() => /login/i.test(location.href)).catch(() => true)
  record('1-session', '登录态保持（未掉回登录页）', !relogin, shell.url().slice(0, 90))
  await shell.screenshot({ path: join(EV, 'poc1-final.png') })

  finish(b)
}

async function finish(b) {
  const { writeFileSync, readFileSync, existsSync } = await import('node:fs')
  const matrixPath = join(HERE, 'matrix.md')
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const rows = results.map(
    r =>
      `| ${r.id} | ${r.name} | ${r.pass ? '✅' : '❌'} | ${String(r.detail).replace(/\|/g, '\\|').slice(0, 160)} |`,
  )
  const block = `\n\n## PoC-1 自动部分（${now}）\n\n| 项 | 验证内容 | 结果 | 详情 |\n|---|---|---|---|\n${rows.join('\n')}\n\n> 证据：poc/shell/evidence/poc1-*.png\n> 待人工后续：心跳驻留 30min、开播→下播信号、弹窗流\n`
  writeFileSync(
    matrixPath,
    (existsSync(matrixPath) ? readFileSync(matrixPath, 'utf8') : '') + block,
  )
  console.log('\n已追加至 matrix.md')
  await b.close().catch(() => {})
  const failed = results.filter(r => !r.pass)
  console.log(
    `== PoC-1 自动部分结论：${failed.length === 0 ? '壳形态风控放行（初步）' : `失败：${failed.map(f => f.id).join(', ')}`} ==`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(async e => {
  console.error('harness 异常：', e)
  process.exit(1)
})
