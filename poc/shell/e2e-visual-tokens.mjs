// 视觉令牌 E2E：entry / chrome / rail panel / assistant / dialog 的真实 computed style。
// 运行：npx vite build && node poc/shell/e2e-visual-tokens.mjs
import path from 'node:path'
import { _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail = '') => {
  results.push({ id, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, timeout, label) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(150)
  }
  throw new Error(`等待超时：${label}`)
}

const app = await electron.launch({
  args: ['.', `--user-data-dir=/tmp/lm-e2e-visual-${Date.now()}`],
  cwd: path.resolve(import.meta.dirname, '../..'),
  env: { ...process.env, LM_SHELL_DEBUG: '1' },
  timeout: 30_000,
})

try {
  const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
  const pageBy = needle =>
    waitFor(() => app.windows().find(w => w.url().includes(needle)), 30_000, `页面 ${needle}`)

  await waitFor(
    async () => {
      const d = await debug()
      return d.entryVisible ? d : null
    },
    20_000,
    'entry',
  )

  const entry = await pageBy('entry.html')
  const es = await entry.evaluate(() => {
    const card = document.querySelector('[data-platform]')
    const title = card?.querySelector('div.text-\\[14px\\]') ?? card?.querySelector('div')
    const cs = card ? getComputedStyle(card) : null
    return {
      body: getComputedStyle(document.body).fontSize,
      radius: cs?.borderRadius,
      padding: cs?.paddingLeft,
      shadow: cs?.boxShadow,
      title: title ? getComputedStyle(title).fontSize : null,
    }
  })
  record(
    'VT-1 entry 卡片 12px/16px/14px，body 13',
    es.body === '13px' &&
      es.radius === '12px' &&
      es.padding === '16px' &&
      es.title === '14px' &&
      es.shadow !== 'none',
    JSON.stringify(es),
  )

  const chrome = await pageBy('chrome.html')
  const cs = await chrome.evaluate(() => {
    const topbar = document.querySelector('#root > div > div')
    return {
      topbar: topbar ? getComputedStyle(topbar).height : null,
      address: document.querySelectorAll('input[placeholder="搜索或输入网址"]').length,
      label: document.body.innerText.includes('选择平台'),
    }
  })
  record(
    'VT-2 chrome entry 52px + 无工具条',
    cs.topbar === '52px' && cs.address === 0 && cs.label,
    JSON.stringify(cs),
  )

  await app.evaluate(({ app: a }) => a.__shellModeSet('live'))
  await app.evaluate(({ app: a }) => a.__shellToggle('live'))
  await waitFor(async () => (await debug()).panelOpen, 10_000, 'dock')
  const rail = await pageBy('rail.html')
  await sleep(500)
  const rs = await rail.evaluate(() => {
    const title = document.querySelector('[data-testid="panel-title"]')
    const section = document.querySelector(
      '[data-testid="status-card"] [data-slot="panel-section"]',
    )
    const connect = document.querySelector('[data-testid="connect-live"]')
    const select = document.querySelector('[data-slot="select-trigger"]')
    return {
      body: getComputedStyle(document.body).fontSize,
      title: title ? getComputedStyle(title).fontSize : null,
      sectionRadius: section ? getComputedStyle(section).borderRadius : null,
      sectionPadding: section ? getComputedStyle(section).paddingLeft : null,
      button: connect ? getComputedStyle(connect).height : null,
      input: select ? getComputedStyle(select).height : null,
      inputFont: select ? getComputedStyle(select).fontSize : null,
    }
  })
  record(
    'VT-3 rail 13px / 12px 卡片 / 28px sm 按钮 / 32px 输入',
    rs.body === '13px' &&
      rs.title === '13px' &&
      rs.sectionRadius === '12px' &&
      rs.sectionPadding === '12px' &&
      rs.button === '28px' &&
      rs.input === '32px' &&
      rs.inputFont === '13px',
    JSON.stringify(rs),
  )

  await chrome.click('button[aria-label="AI 助手"]')
  const assistant = await pageBy('assistant.html')
  await assistant.waitForLoadState().catch(() => {})
  await sleep(400)
  const as = await assistant.evaluate(() => {
    const root = document.querySelector('#root > div')
    const header = root?.querySelector('header')
    const input = document.querySelector('[data-testid="assistant-input"]')
    const title = document.querySelector('[data-testid="assistant-title"]')
    const cs = root ? getComputedStyle(root) : null
    return {
      radius: cs?.borderRadius,
      header: header ? getComputedStyle(header).height : null,
      title: title ? getComputedStyle(title).fontSize : null,
      input: input ? getComputedStyle(input).fontSize : null,
    }
  })
  record(
    'VT-4 assistant 16px/40px/13px',
    as.radius === '16px' && as.header === '40px' && as.title === '13px' && as.input === '13px',
    JSON.stringify(as),
  )

  await assistant.locator('button[aria-label="更多"]').click()
  await waitFor(() => assistant.getByText('配置 API Key').isVisible(), 4000, '配置 API Key')
  await assistant.getByText('配置 API Key').click()
  await waitFor(() => assistant.locator('[data-slot="dialog-content"]').isVisible(), 4000, 'dialog')
  const ds = await assistant.evaluate(() => {
    const dialog = document.querySelector('[data-slot="dialog-content"]')
    const title = dialog?.querySelector('[data-slot="dialog-title"]')
    const cs = dialog ? getComputedStyle(dialog) : null
    return {
      radius: cs?.borderRadius,
      padding: cs?.paddingLeft,
      title: title ? getComputedStyle(title).fontSize : null,
    }
  })
  record(
    'VT-5 dialog 12px/16px/15px',
    ds.radius === '12px' && ds.padding === '16px' && ds.title === '15px',
    JSON.stringify(ds),
  )
} catch (e) {
  record('VT 异常', false, String(e.message ?? e))
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter(r => !r.ok)
console.log(`\n== visual E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
