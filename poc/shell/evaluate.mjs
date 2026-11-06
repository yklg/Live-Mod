// POC — throwaway：PoC-0 attach 自驱动评估 harness（browser-shell-poc-plan v5）
// 前置：LM_SHELL_POC=1 npm run dev（Electron 已暴露 9222，壳窗口已加载抖音登录页）
// 用法：node poc/shell/evaluate.mjs
// 模式：探测 → JS 求值 → pass/fail + 截图 → 写 matrix.md（仿 cloakbrowser stealth_test）
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const CDP = 'http://127.0.0.1:9222'
const HERE = dirname(fileURLToPath(import.meta.url))
const EVIDENCE = join(HERE, 'evidence')
mkdirSync(EVIDENCE, { recursive: true })

const results = []
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${name} — ${detail}`)
}

async function cdpAlive() {
  try {
    const res = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) })
    return await res.json()
  } catch {
    return null
  }
}

async function main() {
  // [g-fuse] CDP 可达即证明 EnableNodeCliInspectArguments fuse 未关闭
  const version = await cdpAlive()
  record(
    'g-fuse',
    'CDP 端口可达（fuse 未禁用）',
    !!version,
    version ? version.Browser : '9222 无响应',
  )
  if (!version) {
    writeMatrix()
    process.exit(1)
  }

  // [a] connectOverCDP + 定位壳窗口 target
  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  const allPages = contexts.flatMap(c => c.pages())
  const shell = allPages.find(p => p.url().includes('jinritemai.com'))
  record(
    'a',
    'attach 后寻址壳窗口 target',
    !!shell,
    shell ? shell.url() : `未找到壳页，现有 ${allPages.length} 个 target`,
  )
  if (!shell) {
    await browser.close()
    writeMatrix()
    process.exit(1)
  }
  await shell.waitForLoadState('domcontentloaded', { timeout: 30_000 })
  const title = await shell.title()
  shell.screenshot({ path: join(EVIDENCE, 'poc0-shell-page.png') }).catch(() => {})
  record('a-load', '壳窗口页面加载', true, `title="${title}"`)

  // [d] 多 target：主 UI 窗口 + 壳窗口应同时可寻址
  record(
    'd',
    '多 target 寻址（主窗口+壳）',
    allPages.length >= 2,
    allPages.map(p => p.url().slice(0, 60)).join(' | '),
  )

  // [b] 可信输入：注入探针按钮/输入框 → CDP 鼠标点击与逐键输入 → 校验 isTrusted
  await shell.evaluate(() => {
    window.__lmPoc = { clicks: [], keydownTrusted: null }
    document.addEventListener('click', e => window.__lmPoc.clicks.push(e.isTrusted), true)
    const btn = document.createElement('button')
    btn.id = 'lm-poc-btn'
    btn.textContent = 'POC'
    btn.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:2147483647;width:48px;height:32px'
    btn.onclick = () => (window.__lmPocBtnHit = true)
    const input = document.createElement('input')
    input.id = 'lm-poc-input'
    input.style.cssText =
      'position:fixed;left:80px;bottom:16px;z-index:2147483647;width:96px;height:32px'
    document.body.append(btn, input)
  })
  const box = await shell.locator('#lm-poc-btn').boundingBox()
  await shell.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await shell.locator('#lm-poc-input').click()
  await shell.locator('#lm-poc-input').pressSequentially('123', { delay: 60 })
  const inputProbe = await shell.evaluate(() => ({
    clicks: window.__lmPoc.clicks,
    btnHit: !!window.__lmPocBtnHit,
    value: document.querySelector('#lm-poc-input')?.value,
  }))
  const trustedClick = inputProbe.clicks.some(c => c === true) && inputProbe.btnHit
  record(
    'b-click',
    'CDP 可信点击（isTrusted=true 且元素响应）',
    trustedClick,
    JSON.stringify(inputProbe.clicks),
  )
  record('b-type', 'CDP 逐键输入生效', inputProbe.value === '123', `value="${inputProbe.value}"`)
  await shell.evaluate(() => {
    document.querySelector('#lm-poc-btn')?.remove()
    document.querySelector('#lm-poc-input')?.remove()
  })

  // [c] 指纹探针 + attach 下 addInitScript 可用性 + webdriver 掩蔽修复验证
  const fp = await shell.evaluate(() => ({
    ua: navigator.userAgent,
    webdriver: navigator.webdriver,
    chromeRuntime: !!globalThis.chrome?.runtime?.id,
  }))
  record(
    'c-ua',
    'UA 已剥离 Electron/LiveMod 标识',
    !/Electron|LiveMod/i.test(fp.ua),
    `ua="${fp.ua}"`,
  )
  let initScriptOk = false
  try {
    // 一次性验证 stealth 回退通道：addInitScript 掩蔽 webdriver + 打标记
    await shell.context().addInitScript({
      content:
        'window.__lmPocInit = true; Object.defineProperty(navigator, "webdriver", { get: () => undefined });',
    })
    await shell.reload({ waitUntil: 'domcontentloaded' })
    const after = await shell.evaluate(() => ({
      init: window.__lmPocInit === true,
      wd: navigator.webdriver,
    }))
    initScriptOk = after.init
    record(
      'c-init',
      'attach 下 context.addInitScript 生效（stealth 回退通道）',
      after.init,
      after.init ? 'reload 后标记存在' : '标记缺失或调用抛错',
    )
    record(
      'c-webdriver-fix',
      'addInitScript 掩蔽 navigator.webdriver 生效',
      after.wd === undefined,
      `webdriver=${String(after.wd)}（原始值 ${String(fp.webdriver)}）`,
    )
  } catch (e) {
    record(
      'c-init',
      'attach 下 context.addInitScript 生效（stealth 回退通道）',
      false,
      e.message.split('\n')[0],
    )
    record('c-webdriver-fix', 'addInitScript 掩蔽 navigator.webdriver 生效', false, '依赖 c-init')
  }

  // [e] 辅助页替代路径：Electron 侧隐藏窗口 → Playwright attach 寻址并驱动
  // （context.newPage() 在 Electron CDP 下不支持 Target.createTarget，属平台限制）
  const newPageErr = await shell
    .context()
    .newPage()
    .then(() => 'unexpectedly ok')
    .catch(e => e.message.split('\n')[0])
  record('e-newpage-limit', 'newPage 平台限制记录（预期不支持）', true, newPageErr)
  const aux = allPages.find(p => p.url().includes('lm-poc-aux'))
  let auxOk = false
  let auxNote = '未找到隐藏辅助 target'
  if (aux) {
    try {
      auxOk = (await aux.evaluate(() => 1 + 1)) === 2
      auxNote = '隐藏 BrowserWindow 可 attach 并 evaluate 驱动'
    } catch (e) {
      auxNote = e.message.split('\n')[0]
    }
  }
  record('e-auxpage', 'Electron 侧隐藏辅助页替代路径可用（多账号/监听页前提）', auxOk, auxNote)

  // [f] 安全断开：browser.close() 应仅断连接，宿主 Electron 必须存活
  await browser.close()
  const afterClose = await cdpAlive()
  let reconnectOk = false
  try {
    const b2 = await chromium.connectOverCDP(CDP)
    reconnectOk = b2
      .contexts()
      .flatMap(c => c.pages())
      .some(p => p.url().includes('jinritemai.com'))
    await b2.close()
  } catch {
    reconnectOk = false
  }
  record(
    'f-close',
    'attached close 仅断连不杀宿主',
    !!afterClose,
    afterClose ? `close 后 CDP 仍响应：${afterClose.Browser}` : '宿主已退出（C1 陷阱实锤）',
  )
  record(
    'f-reconnect',
    '重复 attach 可用',
    reconnectOk,
    reconnectOk ? '二次连接并寻址成功' : '二次连接失败',
  )

  writeMatrix()
  const failed = results.filter(r => !r.pass)
  console.log(
    `\n== PoC-0 结论：${failed.length === 0 ? 'R1\u2019 技术链路成立' : `失败 ${failed.length} 项：${failed.map(f => f.id).join(', ')}`} ==`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

function writeMatrix() {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const rows = results.map(
    r => `| ${r.id} | ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.detail.replace(/\|/g, '\\|')} |`,
  )
  const md = `# 平台 × 环境兼容矩阵（PoC-0 · 自动评估输出）

> 生成时间：${now}（harness: poc/shell/evaluate.mjs）
> 证据目录：poc/shell/evidence/

| 项 | 验证内容 | 结果 | 详情 |
|---|---|---|---|
${rows.join('\n')}

## 安全约束（C2）
- 9222 调试端口当前对生产开放（app.ts:73），正式化必须门控或改 pipe 传输。

## 待人工项（PoC-1）
- 扫码登录 + 风控双判（CreepJS 基线截图 vs 真实 Chrome）
- 弹窗流（window.open → 子 view）
- 下播信号（真实开播→下播，ILiveStatusWatcher 壳化后仍触发）
`
  writeFileSync(join(HERE, 'matrix.md'), md)
  console.log(`\nmatrix.md 已写入：${join(HERE, 'matrix.md')}`)
}

main().catch(err => {
  console.error('harness 异常：', err)
  record('fatal', 'harness 运行', false, err.message.split('\n')[0])
  writeMatrix()
  process.exit(1)
})
