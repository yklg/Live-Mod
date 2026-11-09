// 面板拖拽导体（shell-ui v4）：透明全窗子窗口，只在拖拽期间显示。
// 为什么是 BrowserWindow：Electron 36 的 WebContentsView 没有 setIgnoreMouseEvents，
// rail 视图内的 pointer capture 在指针离开视图后会丢失；透明子窗口能稳定接管全窗指针。
// 与 noticeWindow 解耦：通知是常驻透明 HUD，导体是拖拽专用的输入捕获层。
import { BrowserWindow } from 'electron'
import { buildShellViewArg } from 'shared/shellView'
import { createLogger } from '#/logger'
import { loadAppEntry } from './viewHost'

const logger = createLogger('PanelDragWindow')

let dragWin: BrowserWindow | null = null
let container: BrowserWindow | null = null

function computeBounds(win: BrowserWindow) {
  const content = win.getContentBounds()
  return { x: content.x, y: content.y, width: content.width, height: content.height }
}

export function attachPanelDragWindow(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  container = win
  dragWin = new BrowserWindow({
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
    // 输入捕获层需要接收指针事件；用 showInactive 显示，不抢焦点。
    focusable: true,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [buildShellViewArg('drag')],
    },
  })
  dragWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  loadAppEntry(dragWin, entry, 'drag')

  const sync = () => {
    if (!container || !dragWin || container.isDestroyed() || dragWin.isDestroyed()) return
    dragWin.setBounds(computeBounds(container))
  }
  win.on('move', sync)
  win.on('resize', sync)
  win.on('enter-full-screen', sync)
  win.on('leave-full-screen', sync)
  win.once('closed', () => destroyPanelDragWindow())
  logger.info('面板拖拽导体已创建（透明/预创建隐藏/拖拽时显示）')
}

export function showPanelDragWindow() {
  if (!dragWin || dragWin.isDestroyed() || !container || container.isDestroyed()) return false
  dragWin.setBounds(computeBounds(container))
  dragWin.showInactive()
  return true
}

export function hidePanelDragWindow() {
  if (dragWin && !dragWin.isDestroyed() && dragWin.isVisible()) dragWin.hide()
}

export function isPanelDragWindowVisible() {
  return !!dragWin && !dragWin.isDestroyed() && dragWin.isVisible()
}

export function destroyPanelDragWindow() {
  const win = dragWin
  dragWin = null
  container = null
  try {
    if (win && !win.isDestroyed()) win.destroy()
  } catch (error) {
    logger.warn('面板拖拽导体销毁失败（父窗口关闭路径，忽略）：', error)
  }
}
