import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { emitter } from './event/eventBus'
import { updateManager } from './managers/UpdateManager'
import { providerService } from './services/ProviderService'
import windowManager from './windowManager'
import './ipc'
import { createLogger } from './logger'
import { accountManager } from './managers/AccountManager'

// const _require = createRequire(import.meta.url)

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//

function createBoxedString(lines: string[]) {
  // 1. 计算最长的一行文字长度
  const maxLength = Math.max(...lines.map(line => line.length))

  // 2. 定义边框样式
  // 顶部和底部边框 (例如: +----------------+)
  const horizontalLine = `+${'-'.repeat(maxLength + 2)}+`

  // 3. 生成中间的内容行
  const content = lines
    .map(line => {
      // 使用 padEnd 补齐空格，使得右边框对齐
      return `| ${line.padEnd(maxLength)} |`
    })
    .join('\n')

  // 4. 拼接结果
  return `\n${horizontalLine}\n${content}\n${horizontalLine}`
}

function logStartupInfo() {
  const appInfo = [
    `App Name:     ${app.getName()}`,
    `App Version:  ${app.getVersion()}`,
    `Electron Ver: ${process.versions.electron}`,
    `Node Ver:     ${process.versions.node}`,
    `Platform:     ${process.platform} (${process.arch})`,
    `Environment:  ${app.isPackaged ? 'Production' : 'Development'}`,
  ]
  const logger = createLogger('startup')
  logger.debug(createBoxedString(appInfo))
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// C2（browser-shell-formalization-plan v3 · Phase 0）：生产用随机端口（Chromium 仅绑 127.0.0.1），
// dev 默认 9222 供 harness 复用；LM_CDP_PORT 可显式覆盖。attach 会话经 driver/cdpEndpoint 发现实际端口。
app.commandLine.appendSwitch(
  'remote-debugging-port',
  process.env.LM_CDP_PORT ?? (app.isPackaged ? '0' : '9222'),
)

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: `Live Mod - v${app.getVersion()}`,
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    // 内容首帧就绪前不显示窗口（配合下方 ready-to-show），消除启动闪屏
    show: false,
    // 原生窗口背景与渲染层主题 token 对齐（src/index.css --background），仅在就绪前极端时序下可见
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#020817' : '#ffffff',
    autoHideMenuBar: app.isPackaged,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,
      nodeIntegration: process.env.NODE_ENV === 'development',
      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  windowManager.setMainWindow(win)

  // 内容就绪后再显示；主框架加载失败或渲染进程早期崩溃时兜底显示，避免窗口永久隐藏
  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) win.show()
  })
  win.webContents.on('did-fail-load', (_event, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame && win && !win.isDestroyed() && !win.isVisible()) win.show()
  })
  win.webContents.on('render-process-gone', () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show()
  })

  if (process.env.LM_SHELL_UI === '1') {
    // Phase 2 单窗口壳形态：主窗口变纯容器，React 应用迁移至 panelView
    const { attachContainer } = await import('./windows/shellUI')
    attachContainer(
      win,
      VITE_DEV_SERVER_URL ? { url: VITE_DEV_SERVER_URL } : { file: indexHtml },
      preload,
    )
    win.show()
    // 更新检查改挂 panelView 首帧（容器自身 webContents 不加载内容，did-finish-load 不触发）
    updateManager.silentCheckForUpdate().catch(() => {})
  } else if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // 加载完成后检查更新（经典模式；壳容器模式见上方 panelView 分支）
  if (process.env.LM_SHELL_UI !== '1') {
    win.webContents.on('did-finish-load', async () => {
      await updateManager.silentCheckForUpdate()
    })
  }

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 当返回最新 providers 时推送到渲染进程（经 windowManager 路由，兼容壳容器模式）
  emitter.on('providers-updated', providers => {
    windowManager.send(IPC_CHANNELS.app.providersUpdated, providers)
  })
}

app
  .whenReady()
  .then(logStartupInfo)
  .then(() => providerService.initialize())
  .then(createWindow)

app.on('window-all-closed', async () => {
  win = null
  accountManager.cleanup()
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// stdout/stderr 管道断裂（如从终端启动后终端被关闭、后台宿主断开管道）对 GUI 应用是
// 正常情况：窗口交互不受影响。若不拦截，每次向已关闭的管道写日志都会抛出 EPIPE 并
// 触发下方 uncaughtException 弹窗，造成错误框轰炸。此处静默忽略 EPIPE，其余错误照常抛出。
function ignoreStdioEpipe(stream: NodeJS.WriteStream | null) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return
    throw err
  })
}
ignoreStdioEpipe(process.stdout)
ignoreStdioEpipe(process.stderr)

process.on('uncaughtException', error => {
  // stdio 管道断裂已由 ignoreStdioEpipe 拦截，此处兜底过滤其它来源的 EPIPE，不弹窗
  if (
    (error as NodeJS.ErrnoException)?.code === 'EPIPE' ||
    (error instanceof Error && error.message.includes('EPIPE'))
  ) {
    createLogger('uncaughtException').verbose('忽略管道断裂 (EPIPE)，GUI 功能不受影响')
    return
  }
  const logger = createLogger('uncaughtException')
  logger.error('--------------意外的未捕获异常---------------')
  logger.error(error)
  logger.error('---------------------------------------------')

  dialog.showErrorBox(
    '应用程序错误',
    `发生了一个意外的错误，请前往 Github Issue 页面反馈：\n${error.message}`,
  )
})

process.on('unhandledRejection', reason => {
  // playwright-extra 插件问题：在 browser.close() 时概率触发
  // https://github.com/berstend/puppeteer-extra/issues/858
  const logger = createLogger('unhandledRejection')
  if (
    reason instanceof Error &&
    reason.message.includes('cdpSession.send: Target page, context or browser has been closed')
  ) {
    return logger.verbose(reason)
  }

  logger.error('--------------未被处理的错误---------------')
  logger.error(reason)
  logger.error('-------------------------------------------')
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})
