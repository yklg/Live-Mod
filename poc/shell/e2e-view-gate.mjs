// POC — seamless-fix v3 · A0 实验门禁：view+deny-all 下抖音 attach 三断言
// 前置：LM_SHELL_UI=1 LM_CDP_PORT=9222 npx electron . --remote-debugging-port=9222 --user-data-dir=/tmp/lm-poc-profile
// 断言：①targets 恰为 2（panelView+pageView，无第三 OS 窗口）②pageView URL 达中控台 ③CDP 可信点击生效
// 任一失败输出三断言现场值（回报模板），退出码非 0 → 触发 Plan B 回报流程
import process from 'node:process'
import { chromium } from 'playwright'

const CDP = 'http://127.0.0.1:9222'
const results = []
const record = (id, pass, detail) => {
  results.push({ id, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${detail}`)
}

async function main() {
  const b = await chromium.connectOverCDP(CDP)
  const panel = b
    .contexts()
    .flatMap(c => c.pages())
    .find(p => p.url().includes('index.html'))
  if (!panel) {
    record('pre', false, '未找到 panelView')
    return finish(b)
  }

  const r = await panel.evaluate(async () =>
    window.ipcRenderer.invoke('tasks:liveControl:connect', {
      headless: false,
      chromePath: '',
      storageState: '',
      platform: 'douyin',
      account: { id: 'default', name: '默认账号' },
      mode: 'attach',
    }),
  )
  await new Promise(res => setTimeout(res, 4000))

  const pages = b.contexts().flatMap(c => c.pages())
  const pv = pages.find(p => p !== panel && p.url().includes('jinritemai'))
  // ① targets 恰为 2
  record(
    'gate-1',
    pages.length === 2 && !!pv,
    `targets=${pages.length}（期望 2），现场: ${pages.map(p => p.url().slice(0, 50)).join(' | ')}`,
  )
  // ② URL 达中控台
  const url = pv ? pv.url() : r ? '(connect=true 但无 pageView)' : `connect=${r} 无 pageView`
  record(
    'gate-2',
    !!pv && /live\/control|content-tool/.test(url),
    `pageView URL: ${url.slice(0, 90)}`,
  )
  // ③ 可信点击
  let clickOk = false
  if (pv) {
    try {
      await pv.evaluate(() => {
        window.__gate = { trusted: null }
        const btn = document.createElement('button')
        btn.id = 'gate-btn'
        btn.textContent = 'G'
        btn.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647'
        btn.onclick = () => (window.__gate.trusted = true)
        document.body.appendChild(btn)
      })
      const box = await pv.locator('#gate-btn').boundingBox()
      await pv.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      clickOk = await pv.evaluate(() => window.__gate.trusted === true)
      await pv.evaluate(() => document.querySelector('#gate-btn')?.remove())
    } catch (e) {
      clickOk = false
    }
  }
  record('gate-3', clickOk, clickOk ? '注入按钮经 CDP 点击响应' : '可信点击失败')
  finish(b)
}

function finish(b) {
  b?.close().catch(() => {})
  const failed = results.filter(r => !r.pass)
  if (failed.length) {
    console.log('\n== A0 门禁失败——按回报模板提交三断言现场值，Plan B 须用户批准后才可执行 ==')
    process.exit(1)
  }
  console.log('\n== A0 门禁通过：view + deny 弹窗组合成立，按计划 A/B 节全量落地 ==')
  process.exit(0)
}

main().catch(e => {
  console.error('harness 异常：', e.message.split('\n')[0])
  process.exit(1)
})
