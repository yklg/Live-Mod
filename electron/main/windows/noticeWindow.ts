// 壳级通知覆盖窗口（shell-ui-polish v3）
// 为什么是 BrowserWindow 而非 WebContentsView（Step 1.0 技术探针结论）：
//   Electron 36 的 View/WebContentsView **没有** setIgnoreMouseEvents（仅 BrowserWindow/BaseWindow 有），
//   透明 WebContentsView 会捕获页面鼠标事件 → 无法满足「点击穿透」决策 D2a。
//   因此改用「透明子窗口」承载通知 HUD：窗口级 setIgnoreMouseEvents(true,{forward:true}) 实现真穿透，
//   子窗口天然位于父窗口之上（最顶层），跟随父窗口 move/resize。展示态仍归 notice 渲染层。
import { BrowserWindow } from 'electron'
import { buildNoticeTestMsArg, buildShellViewArg } from 'shared/shellView'
import { createLogger } from '#/logger'
import { installExternalProtocolGuard } from './externalProtocolGuard'
import { CHROME_H } from './shellLayout'
import { loadAppEntry } from './viewHost'

const logger = createLogger('ShellNoticeWindow')

export const NOTICE_WIN_W = 400
export const NOTICE_WIN_H = 280
const NOTICE_MARGIN = 16

let noticeWin: BrowserWindow | null = null
let container: BrowserWindow | null = null

function noticeArgs(): string[] {
  const args = [buildShellViewArg('notice')]
  const raw = process.env.LM_SHELL_NOTICE_TEST_MS
  if (process.env.LM_SHELL_DEBUG === '1' && raw) {
    const ms = Number(raw)
    if (Number.isFinite(ms) && ms > 0) args.push(buildNoticeTestMsArg(ms))
  }
  return args
}

/** 通知窗口屏幕坐标：父窗口页面区右上（content 坐标 + chrome 高度；窗口坐标 = 屏幕坐标） */
export function computeNoticeWindowBounds(win: BrowserWindow): {
  x: number
  y: number
  width: number
  height: number
} {
  const content = win.getContentBounds()
  return {
    x: content.x + content.width - NOTICE_WIN_W - NOTICE_MARGIN,
    y: content.y + CHROME_H + NOTICE_MARGIN,
    width: NOTICE_WIN_W,
    height: NOTICE_WIN_H,
  }
}

export function attachNoticeWindow(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  container = win
  noticeWin = new BrowserWindow({
    parent: win,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    acceptFirstMouse: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: noticeArgs(),
    },
  })
  noticeWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  installExternalProtocolGuard(noticeWin.webContents, msg => logger.warn(msg))
  loadAppEntry(noticeWin, entry, 'notice')
  // 点击穿透：窗口级 API（View 无此能力）
  noticeWin.setIgnoreMouseEvents(true, { forward: true })
  noticeWin.setBounds(computeNoticeWindowBounds(win))

  const syncBounds = () => {
    if (!container || !noticeWin || container.isDestroyed() || noticeWin.isDestroyed()) return
    noticeWin.setBounds(computeNoticeWindowBounds(container))
  }
  win.on('move', syncBounds)
  win.on('resize', syncBounds)
  win.on('enter-full-screen', syncBounds)
  win.on('leave-full-screen', syncBounds)

  noticeWin.once('ready-to-show', () => {
    if (!noticeWin || noticeWin.isDestroyed()) return
    syncBounds()
    noticeWin.showInactive()
  })
  win.once('closed', () => destroyNoticeWindow())
  logger.info('通知覆盖窗口已创建（透明/点击穿透/跟随父窗口）')
}

export function getNoticeWindowWebContents(): Electron.WebContents | null {
  return noticeWin && !noticeWin.isDestroyed() ? noticeWin.webContents : null
}

export function getNoticeWindowDebug() {
  const win = noticeWin
  return {
    url: win && !win.isDestroyed() ? win.webContents.getURL() : '',
    visible: win && !win.isDestroyed() ? win.isVisible() : false,
    bounds: win && !win.isDestroyed() ? win.getBounds() : null,
    expectedBounds:
      container && !container.isDestroyed() ? computeNoticeWindowBounds(container) : null,
  }
}

export function destroyNoticeWindow() {
  const win = noticeWin
  noticeWin = null
  container = null
  try {
    if (win && !win.isDestroyed()) win.destroy()
  } catch (error) {
    logger.warn('通知窗口销毁失败（父窗口关闭路径，忽略）：', error)
  }
}
