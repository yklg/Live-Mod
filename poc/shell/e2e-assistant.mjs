// AI 助手浮窗 E2E：懒创建、顶栏入口、关闭=hide、更多菜单、无 Key 提示。
// 运行：node poc/shell/e2e-assistant.mjs（需先构建）
import path from 'node:path'
import { _electron as electron } from 'playwright'

const step = s => process.stderr.write(`[step] ${s}\n`)
const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
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
    await sleep(100)
  }
  throw new Error(`等待超时：${label}`)
}
step('launch')
const app = await electron.launch({
  args: ['.', `--user-data-dir=/tmp/lm-e2e-assistant-${Date.now()}`],
  cwd: path.resolve(import.meta.dirname, '../..'),
  env: { ...process.env, LM_SHELL_DEBUG: '1' },
  timeout: 30_000,
})
try {
  const debug = () => app.evaluate(({ app: a }) => a.__shellDebug())
  const pageBy = needle =>
    waitFor(() => app.windows().find(w => w.url().includes(needle)), 15_000, `页面 ${needle}`)

  step('chrome page')
  const chrome = await pageBy('chrome.html')
  await chrome.waitForLoadState().catch(() => {})
  record('A1 启动时 assistant 未创建/未打开', (await debug()).assistantOpen === false, '')
  step('click ai')
  await chrome.click('button[aria-label="AI 助手"]')
  step('assistant page')
  const assistant = await pageBy('assistant.html')
  await assistant.waitForLoadState().catch(() => {})
  record('A2 顶栏打开 assistant', (await debug()).assistantOpen === true, '')
  record('A3 空态引导', await assistant.getByText('今天想先处理什么？').isVisible(), '')

  step('prompt')
  await assistant.getByText('帮我写 3 条不重复的欢迎话术').click()
  const filled = await assistant.locator('textarea').inputValue()
  record('A4 快捷提问填入输入框', filled.includes('欢迎话术'), filled)
  step('send')
  await assistant.locator('button[aria-label="发送"]').click()
  await waitFor(() => assistant.getByText('还没有配置 API Key').isVisible(), 5000, '无 Key 提示')
  record('A5 无 Key 行内提示', true, '')

  step('more')
  await assistant.locator('button[aria-label="更多"]').click()
  await waitFor(() => assistant.getByText('当前模型').isVisible(), 3000, '更多菜单')
  record('A6 更多菜单含模型/配置/清空', true, '')

  step('close')
  await assistant.locator('button[aria-label="关闭"]').click()
  await waitFor(async () => (await debug()).assistantOpen === false, 5000, '关闭=hide')
  record('A7 关闭=hide（窗口保留）', true, '')
  record(
    'A8 关闭后 assistant 页面仍在（隐藏保留对话）',
    app.windows().some(w => w.url().includes('assistant.html')),
    '',
  )

  step('click ai')
  step('reopen')
  await chrome.click('button[aria-label="AI 助手"]')
  await waitFor(async () => (await debug()).assistantOpen === true, 5000, '再次打开')
  record('A9 再次打开恢复', true, '')

  step('cmd+j close')
  await app.evaluate(({ app: a }) => a.__shellFocusView('chrome'))
  await app.evaluate(({ app: a }) => a.__shellSendInputEvent('J', ['meta']))
  await waitFor(async () => (await debug()).assistantOpen === false, 5000, 'Cmd+J 关闭')
  record('A10 Cmd+J 关闭浮窗', true, '')
  step('cmd+j reopen')
  await app.evaluate(({ app: a }) => a.__shellFocusView('chrome'))
  await app.evaluate(({ app: a }) => a.__shellSendInputEvent('J', ['meta']))
  await waitFor(async () => (await debug()).assistantOpen === true, 5000, 'Cmd+J 打开')
  record('A11 Cmd+J 再次打开', true, '')
} catch (e) {
  record('E2E 异常', false, e.message)
} finally {
  await app.close().catch(() => {})
  try {
    app.process().kill('SIGKILL')
  } catch {}
}
const failed = results.filter(r => !r.ok)
console.log(`\n== assistant E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length ? 1 : 0)
