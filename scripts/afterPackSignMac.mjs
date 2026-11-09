// macOS 发布包 ad-hoc 签名（无 Apple Developer 证书时的兜底）。
//
// 为什么必须签整个 .app：
//   electron-builder 在没有 CSC_LINK/证书时会跳过签名，产物主可执行文件只剩 Electron 自带的
//   linker-signed（bundle 未绑定、没有 _CodeSignature/CodeResources）。macOS 15 Gatekeeper 对
//   这种「签名残缺」的下载包直接报「已损坏，无法打开」；即使手动清掉 quarantine，LaunchServices
//   启动也会静默退出（v1.8.0 实测：进程 0.1s 内退出、无日志）。ad-hoc 签整个 bundle 后
//   `codesign --verify --deep --strict` 通过，清掉 quarantine 即可正常双击启动（v1.8.0 实测通过）。
//
// 与真实签名/公证的关系：
//   - 本 hook 在 electron-builder 的签名步骤**之前**执行；若配置了 Developer ID 证书
//     （CSC_LINK / CSC_NAME 或 keychain 中可自动发现），后续正式签名会覆盖本次 ad-hoc 签名，
//     不会影响正式分发。
//   - 尚未配置证书时不签名 = 产物必然「已损坏」，所以这里无条件兜底。
//
// 仅在 darwin 生效；Windows/Linux 构建直接跳过（日志里会看到一次 skip 记录）。
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** @param {import('app-builder-lib').AfterPackContext} context */
export default async function afterPackSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  console.log(`[afterPack] ad-hoc 签名 macOS 产物：${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], {
    stdio: 'inherit',
  })
}
