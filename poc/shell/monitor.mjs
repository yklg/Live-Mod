// POC — throwaway：壳形态长时间驻留稳定性监测器（保持 attach 连接，不碰直播中控台）
// 背景：本场直播在另开的浏览器里播，POC 壳窗口非直播窗口，故本监测只验证
//       壳形态在真实登录账号下长时间 attach 稳定性（心跳驻留核心指标），
//       不检测下播信号（下播信号留待正式化阶段或 dev 平台模拟验证）。
// 每 5 分钟一轮：复用同一 attach 连接 → 探活壳页 → 记录 URL/登录态/风控/正文长度 + 一次无害可信鼠标移动。
// 默认运行 6 小时（覆盖到午夜下播后）。触发风控红线立即停止。
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const CDP = 'http://127.0.0.1:9222'
const HERE = dirname(fileURLToPath(import.meta.url))
const EV = join(HERE, 'evidence')
mkdirSync(EV, { recursive: true })
const LOG = join(EV, 'monitor.log')
const INTERVAL = 5 * 60 * 1000
const RUN_MS = 6 * 60 * 60 * 1000
const DEADLINE = Date.now() + RUN_MS

const stats = { probes: 0, reconnects: 0, sessionDropped: 0, risk: 0, dead: 0, alive: 0 }
function log(line) {
  const t = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })
  appendFileSync(LOG, `[${t}] ${line}\n`)
  console.log(`[${t}] ${line}`)
}
appendFileSync(
  LOG,
  `\n== 驻留监测开始，预计运行 ${RUN_MS / 3600000}h 至 ${new Date(DEADLINE).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ==\n`,
)

async function connect() {
  try {
    const b = await chromium.connectOverCDP(CDP)
    stats.reconnects++
    return b
  } catch (e) {
    log(`attach 失败: ${e.message.split('\n')[0]}`)
    return null
  }
}

function findShell(b) {
  return b
    .contexts()
    .flatMap(c => c.pages())
    .find(p => p.url().includes('jinritemai.com'))
}

async function main() {
  let browser = await connect()
  if (!browser) {
    log('FATAL 初始 attach 失败，宿主可能未运行。退出。')
    process.exit(1)
  }
  log('初始 attach 成功')

  while (Date.now() < DEADLINE) {
    stats.probes++
    if (!browser) {
      browser = await connect()
      if (!browser) {
        await sleep(INTERVAL)
        continue
      }
    }
    const shell = findShell(browser)
    if (!shell) {
      stats.dead++
      log(`DEAD 壳页 target 消失（累计 ${stats.dead}）— 窗口可能被关/崩溃，尝试重连`)
      await browser.close().catch(() => {})
      browser = null
      await sleep(INTERVAL)
      continue
    }
    const url = shell.url()
    if (/verify|captcha|slider|punish/i.test(url)) {
      stats.risk++
      log(`RISK 风控页跳转（红线）: ${url.slice(0, 80)} — 立即停止监测`)
      break
    }
    if (/\/login/i.test(url)) {
      stats.sessionDropped++
      log(`SESSION-DROPPED 掉回登录页（累计 ${stats.sessionDropped}）: ${url.slice(0, 60)}`)
      await sleep(INTERVAL)
      continue
    }
    const st = await shell
      .evaluate(() => ({ title: document.title, bodyLen: document.body.innerText.length }))
      .catch(() => null)
    if (!st) {
      stats.dead++
      log(`DEAD 页面不可评估（累计 ${stats.dead}）`)
      await browser.close().catch(() => {})
      browser = null
      await sleep(INTERVAL)
      continue
    }
    stats.alive++
    await shell.mouse.move(6, 6).catch(() => {}) // 无害可信输入活性，不点击
    log(`ALIVE | ${st.title} | body=${st.bodyLen} | url=${url.slice(0, 55)}`)
    await sleep(INTERVAL)
  }

  await browser?.close().catch(() => {})
  const summary =
    `\n== 驻留监测结束 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ==\n` +
    `探针 ${stats.probes} | 存活 ${stats.alive} | 掉线重连 ${stats.reconnects} | 掉登录 ${stats.sessionDropped} | 目标消失 ${stats.dead} | 风控 ${stats.risk}\n` +
    `结论：${stats.risk === 0 && stats.dead === 0 && stats.alive >= stats.probes * 0.9 ? '壳形态长时间 attach 稳定（心跳驻留通过）' : '存在异常，详见上方逐条记录'}\n`
  appendFileSync(LOG, summary)
  console.log(summary)
  process.exit(0)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
main().catch(e => {
  log('harness 异常: ' + e.message.split('\n')[0])
  process.exit(1)
})
