if (typeof process.setSourceMapsEnabled === 'function') {
  process.setSourceMapsEnabled(true)
}

import { app } from 'electron'

// C2（browser-shell-formalization-plan v3 · Phase 0 + 壳内登录 v3 实证修正）：
// 实证：开关必须在主入口同步顶层注入才可靠生效——放在 app.ts（经 import() 异步加载）时
// 端口不绑定、DevToolsActivePort 不写（porttest 同步顶层可绑定，随机端口策略本身有效）。
// 策略：默认随机端口（打包/开发一致，杜绝固定 9222 多实例冲突静默失败），
// 发现链走 driver/cdpEndpoint 端口文件；LM_CDP_PORT 仅供 harness 显式固定。
app.commandLine.appendSwitch('remote-debugging-port', process.env.LM_CDP_PORT ?? '0')

import('./app')
