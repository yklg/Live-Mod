// 壳 E2E 顺序执行器（测试编排稳定性 TC-15）
//
// 为什么不继续用 `a && b && c`：
//   1. 每个脚本都会启动完整 Electron；连续拉起时实例/句柄回收存在竞争，
//      表现为后一个脚本偶发「重启恢复/首屏」超时（本地实测）。
//   2. `&&` 在首个失败即中断，后续脚本完全没跑，无法得到完整回归面。
//
// 本执行器只做两件事：顺序执行 + 脚本间留出回收窗口；每个脚本内部仍负责
// 自己的唯一 user-data-dir 与清理。运行：
//   node poc/shell/e2e-suite.mjs
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const SCRIPTS = [
  'e2e-shell-parity.mjs',
  'e2e-shell-login.mjs',
  'e2e-popup-tabs.mjs',
  'e2e-tab-liveness.mjs',
  'e2e-tabs.mjs',
  'e2e-panel-resize.mjs',
  'e2e-entry-startup.mjs',
  'e2e-panel-density.mjs',
  'e2e-visual-tokens.mjs',
  'e2e-assistant.mjs',
]

// Electron 进程退出到下一次 single-instance/窗口句柄回收之间的保守间隔
const RECYCLE_MS = 1200
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
for (const script of SCRIPTS) {
  console.log(`\n===== ${script} =====`)
  const started = Date.now()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync(process.execPath, [path.join(import.meta.dirname, script)], {
    stdio: 'inherit',
    env,
  })
  const ok = child.status === 0
  results.push({ script, ok, status: child.status, ms: Date.now() - started })
  console.log(`EXIT=${child.status} (${Date.now() - started}ms)`)
  if (!ok) console.log(`[suite] ${script} 失败，继续执行后续脚本`)
  await sleep(RECYCLE_MS)
}

const failed = results.filter(r => !r.ok)
console.log(`\n===== 套件汇总：${results.length - failed.length}/${results.length} 通过 =====`)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.script} ${r.ms}ms`)
process.exit(failed.length === 0 ? 0 : 1)
