// POC — Phase 1 验收：dev 平台 attach 全流程（TC-E1 的 dev 变体，零真实平台风险）
// 前置：LM_CDP_PORT=9222 npx electron .（正式代码路径，非 LM_SHELL_POC）
// 流程：renderer 真实入口 invoke connect(dev, mode=attach) → 断言壳窗口出现 →
//       在壳页执行一次任务级操作（dev 平台按钮点击）→ disconnect → 断言壳窗口关闭 + 宿主存活。
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
  const pages = () => b.contexts().flatMap(c => c.pages())
  const ui = pages().find(p => p.url().includes('dist/index.html') || p.url().includes('127.0.0.1'))
  if (!ui) {
    record('entry', false, '未找到主窗口 renderer，检查应用是否启动')
    return finish(b)
  }
  record('entry', true, `主窗口：${ui.url().slice(0, 60)}`)

  // 1. 真实入口：renderer invoke connect（attach + dev 平台）
  const connectResult = await ui.evaluate(async () => {
    const { ipcRenderer } = window
    return ipcRenderer.invoke('tasks:liveControl:connect', {
      headless: false,
      chromePath: '',
      storageState: '',
      platform: 'dev',
      account: { id: 'poc-e2e', name: 'E2E账号' },
      mode: 'attach',
    })
  })
  record('connect', connectResult === true, `connect 返回 ${connectResult}`)
  if (connectResult !== true) return finish(b)

  // 2. 壳窗口应出现（标题含 accountId），且 dev 平台已写入内容
  await new Promise(r => setTimeout(r, 1500))
  const shell = pages().find(p => p.url().includes('lm-nonce-poc-e2e') || p.url().includes('dev'))
  const shellTargets = pages().filter(p => p !== ui)
  record(
    'shell-window',
    shellTargets.length >= 1,
    `非主窗口 target 数：${shellTargets.length} → ${shellTargets.map(t => t.url().slice(0, 40)).join(' | ')}`,
  )

  // 3. 任务级操作：在壳页里找 dev 平台的可点元素点一下（证明 attach 驱动真实生效）
  const op = await shellTargets
    .map(async t => {
      try {
        const btn = t.locator('button').first()
        if ((await btn.count()) > 0) {
          await btn.click({ timeout: 5000 })
          return `clicked:${t.url().slice(0, 30)}`
        }
      } catch {}
      return null
    })
    .reduce(async (acc, p) => (await acc) || (await p), null)
  record('task-op', Boolean(op), op ?? '壳页无按钮可点（dev 页面未写入？）')

  // 4. 断开：壳窗口应关闭
  const disconnectResult = await ui.evaluate(async () =>
    window.ipcRenderer.invoke('tasks:liveControl:disconnect', 'poc-e2e'),
  )
  await new Promise(r => setTimeout(r, 1500))
  const afterTargets = pages().filter(p => p.url().includes('lm-nonce') || p.url().includes('dev'))
  record(
    'disconnect',
    disconnectResult === true && afterTargets.length === 0,
    `disconnect=${disconnectResult} 残留壳target=${afterTargets.length}`,
  )

  // 5. 宿主存活：close 本连接后 CDP 仍可达
  await b.close()
  const alive = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) })
    .then(r => r.ok)
    .catch(() => false)
  record(
    'host-alive',
    alive,
    alive ? 'attached 断开后宿主 Electron 存活（C1 终验）' : '宿主被杀——C1 陷阱复现',
  )
  finish(null)
}

function finish(b) {
  b?.close().catch(() => {})
  const failed = results.filter(r => !r.pass)
  console.log(
    `\n== Phase 1 dev-attach 验收：${failed.length === 0 ? '通过' : `失败 ${failed.length} 项`} ==`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('harness 异常：', e.message.split('\n')[0])
  process.exit(1)
})
