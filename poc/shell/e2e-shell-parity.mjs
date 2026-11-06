// 壳界面对标 E2E（guangquan-shell-ui-parity v3 · TC-G1~G3，外部经验：Electron 官方 _electron.evaluate）
// 前置：
//   1. pnpm build（或 npx vite build 产出 dist + dist-electron）
//   2. LM_SHELL_UI=1 LM_SHELL_DEBUG=1 由本脚本注入启动
// 契约（主进程实现方须提供，仅 LM_SHELL_DEBUG=1 注册，生产不暴露）：
//   app.__shellDebug(): { panelOpen, routeId, railWidth, childrenUrls: string[] }
//   app.__shellToggle(routeId?): void   —— 等价于 railToggle 请求路径
// 运行：node poc/shell/e2e-shell-parity.mjs   （输出 PASS/FAIL，非零退出码=失败）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { _electron as electron } from 'playwright'

const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}

async function main() {
  const app = await electron.launch({
    // 独立 user-data-dir（每次唯一）：避免与运行中实例/上次孤儿残留抢单实例锁
    args: ['.', `--user-data-dir=/tmp/lm-e2e-profile-${Date.now()}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, LM_SHELL_UI: '1', LM_SHELL_DEBUG: '1' },
  })
  const proc = app.process()
  proc.stderr.on('data', d => process.stderr.write(`[electron] ${d}`))
  proc.stdout.on('data', d => process.stdout.write(`[electron] ${d}`))
  let win
  try {
    win = await app.firstWindow({ timeout: 30_000 })
  } catch (e) {
    // 启动失败诊断：进程存活与主进程状态
    const alive = !proc.killed
    let info = 'evaluate 不可用'
    try {
      info = await app.evaluate(
        ({ app: a, BrowserWindow: BW }) =>
          `ready=${a.isReady()} windows=${BW.getAllWindows().length}`,
      )
    } catch (e2) {
      info = `evaluate 失败: ${e2.message}`
    }
    let startup = '无启动异常记录'
    try {
      startup = readFileSync('/tmp/lm-e2e-startup.txt', 'utf-8')
    } catch {}
    console.error(
      `[diag] firstWindow 超时；进程存活=${alive}；主进程状态=${info}\n[diag] startup:\n${startup}`,
    )
    throw e
  }
  await win.waitForLoadState()

  const debug = async () =>
    app.evaluate(({ app: a }) => {
      if (!a.__shellDebug) throw new Error('LM_SHELL_DEBUG 契约未注册：app.__shellDebug 缺失')
      return a.__shellDebug()
    })
  const toggle = routeId => app.evaluate(({ app: a }, r) => a.__shellToggle(r), routeId ?? null)

  // ---- TC-G1 panelOpen 单源：推送态与 rail 实际宽度同步 ----
  try {
    const closed = await debug()
    await toggle('popup')
    const open = await debug()
    const paired = s => s.panelOpen === s.railWidth > 56
    record(
      'TC-G1',
      closed.panelOpen === false && open.panelOpen === true && paired(open) && paired(closed),
      `closed(panelOpen=${closed.panelOpen},railWidth=${closed.railWidth}) → open(panelOpen=${open.panelOpen},railWidth=${open.railWidth})`,
    )
    await toggle('popup') // 收起路径回归
    const again = await debug()
    record('TC-G1b', again.panelOpen === false, `同 route 再 toggle → panelOpen=${again.panelOpen}`)
  } catch (e) {
    record('TC-G1', false, String(e.message ?? e))
  }

  // ---- TC-G2 z-order：page 恒底，entry 其次，chrome/rail 恒顶（v1 入口视图加入后更新）----
  try {
    const { childrenUrls } = await debug()
    const top2 = childrenUrls.slice(-2)
    const isChromeRail = top2.some(u => u.includes('chrome')) && top2.some(u => u.includes('rail'))
    const isEntrySecond = (childrenUrls[1] ?? '').includes('entry.html')
    const bottomIsPage = !['chrome', 'rail', 'entry'].some(k => childrenUrls[0]?.includes(k))
    record(
      'TC-G2',
      isChromeRail && isEntrySecond && bottomIsPage && childrenUrls.length >= 4,
      `children(底→顶)=${JSON.stringify(childrenUrls)}`,
    )
  } catch (e) {
    record('TC-G2', false, String(e.message ?? e))
  }

  // ---- TC-G3 三 view 截图基线（人工对照 .screenshots/shell-parity/ 与光圈截图）----
  try {
    const outDir = path.resolve(import.meta.dirname, '../../.screenshots/shell-parity')
    mkdirSync(outDir, { recursive: true })
    const pngs = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return Promise.all(
        win.contentView.children.map(async c => ({
          url: c.webContents.getURL(),
          png: Array.from((await c.webContents.capturePage()).toPNG()),
        })),
      )
    })
    for (const { url, png } of pngs) {
      const name = (url.match(/(chrome|rail|entry|buyin|control|about)/)?.[0] ?? 'tab') + '.png'
      writeFileSync(path.join(outDir, name), Buffer.from(png))
    }
    record(
      'TC-G3',
      pngs.length >= 4,
      `已捕获 ${pngs.length} 个 view → ${outDir}（人工对照光圈截图）`,
    )
  } catch (e) {
    record('TC-G3', false, String(e.message ?? e))
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n== E2E 汇总：${results.length - failed.length}/${results.length} PASS ==`)
  await app.close().catch(() => {})
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => {
  console.error('E2E 运行失败（检查前置：pnpm build）：', e)
  process.exit(1)
})
