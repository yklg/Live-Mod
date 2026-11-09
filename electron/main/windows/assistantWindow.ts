// AI 助手全局浮窗（唯一 AI 形态）
// 关闭=hide（保留对话与流式）；主窗口关闭/应用退出才 destroy。
// 位置相对父窗口内容区持久化；native move/resize 后夹紧/吸附并回写。
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { buildShellViewArg } from 'shared/shellView'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import {
  ASSISTANT_MIN_HEIGHT,
  ASSISTANT_MIN_WIDTH,
  clampAssistantRect,
  defaultAssistantRect,
  snapAssistantRect,
  type WindowRect,
  type WindowSize,
} from './assistantGeometry'
import { loadAppEntry } from './viewHost'

const logger = createLogger('AssistantWindow')
export const ASSISTANT_STORE_FILE = 'assistant-window.json'
const ASSISTANT_STORE_VERSION = 1

interface AssistantMemory {
  version: number
  rect: WindowRect | null
}

let assistantWin: BrowserWindow | null = null
let container: BrowserWindow | null = null
let pendingShow = false
let savedRect: WindowRect | null = null
let adjusting = false
let quitting = false

app.on('before-quit', () => {
  quitting = true
})

function contentSize(win: BrowserWindow): WindowSize {
  const [width, height] = win.getContentSize()
  return { width, height }
}

function contentOrigin(win: BrowserWindow) {
  const b = win.getContentBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function screenBounds(win: BrowserWindow, rect: WindowRect) {
  const origin = contentOrigin(win)
  return {
    x: origin.x + rect.x,
    y: origin.y + rect.y,
    width: rect.width,
    height: rect.height,
  }
}

function relativeRect(win: BrowserWindow, viewport: WindowSize): WindowRect {
  const origin = contentOrigin(win)
  const b = win.getBounds()
  return clampAssistantRect(
    { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height },
    viewport,
  )
}

function getMemoryPath() {
  return path.join(app.getPath('userData'), ASSISTANT_STORE_FILE)
}

function loadMemory(): AssistantMemory {
  try {
    const parsed = JSON.parse(fs.readFileSync(getMemoryPath(), 'utf8')) as AssistantMemory
    if (parsed?.version !== ASSISTANT_STORE_VERSION || !parsed.rect)
      return { version: 1, rect: null }
    return { version: 1, rect: parsed.rect }
  } catch {
    return { version: 1, rect: null }
  }
}

function saveMemory(rect: WindowRect) {
  savedRect = rect
  try {
    fs.writeFileSync(
      getMemoryPath(),
      JSON.stringify({ version: ASSISTANT_STORE_VERSION, rect } satisfies AssistantMemory, null, 2),
      'utf8',
    )
  } catch (error) {
    logger.warn('AI 浮窗位置记忆写入失败（不阻断）：', error)
  }
}

function positionWindow(rect: WindowRect) {
  if (!assistantWin || !container || assistantWin.isDestroyed() || container.isDestroyed()) return
  const viewport = contentSize(container)
  const clamped = clampAssistantRect(rect, viewport)
  adjusting = true
  try {
    assistantWin.setBounds(screenBounds(container, clamped))
  } finally {
    adjusting = false
  }
  savedRect = clamped
}

function syncFromWindow() {
  if (adjusting || !assistantWin || !container) return
  const viewport = contentSize(container)
  const raw = relativeRect(assistantWin, viewport)
  const snapped = snapAssistantRect(raw, viewport, { x: false, y: false })
  const next = snapped.rect
  if (
    next.x !== raw.x ||
    next.y !== raw.y ||
    next.width !== raw.width ||
    next.height !== raw.height
  ) {
    positionWindow(next)
  } else {
    savedRect = raw
  }
  saveMemory(savedRect ?? raw)
}

export function attachAssistantWindow(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  container = win
  const memory = loadMemory()
  savedRect = memory.rect
  assistantWin = new BrowserWindow({
    parent: win,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    movable: true,
    minWidth: ASSISTANT_MIN_WIDTH,
    minHeight: ASSISTANT_MIN_HEIGHT,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    focusable: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [buildShellViewArg('assistant')],
    },
  })
  assistantWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  loadAppEntry(assistantWin, entry, 'assistant')
  windowManager.setTarget('assistant', assistantWin.webContents)

  const showAtSaved = () => {
    if (!assistantWin || !container || assistantWin.isDestroyed() || container.isDestroyed()) return
    const viewport = contentSize(container)
    const rect = savedRect ?? defaultAssistantRect(viewport)
    positionWindow(clampAssistantRect(rect, viewport))
    assistantWin.show()
    assistantWin.focus()
  }

  assistantWin.once('ready-to-show', () => {
    if (pendingShow) {
      pendingShow = false
      showAtSaved()
    }
  })
  assistantWin.on('move', syncFromWindow)
  assistantWin.on('resize', syncFromWindow)
  assistantWin.on('close', event => {
    // 关闭按钮走 hide（renderer 发 assistantClose）；这里兜底拦截系统关闭。
    if (!assistantWin || assistantWin.isDestroyed() || quitting) return
    if (!(assistantWin as BrowserWindow & { __allowClose?: boolean }).__allowClose) {
      event.preventDefault()
      hideAssistantWindow()
    }
  })

  let wasVisibleBeforeMinimize = false
  let wasVisibleBeforeFullscreen = false
  win.on('minimize', () => {
    wasVisibleBeforeMinimize = isAssistantWindowVisible()
    if (wasVisibleBeforeMinimize) hideAssistantWindow()
  })
  win.on('restore', () => {
    if (wasVisibleBeforeMinimize) showAssistantWindow()
    wasVisibleBeforeMinimize = false
  })
  win.on('enter-full-screen', () => {
    wasVisibleBeforeFullscreen = isAssistantWindowVisible()
    if (wasVisibleBeforeFullscreen) hideAssistantWindow()
  })
  win.on('leave-full-screen', () => {
    if (wasVisibleBeforeFullscreen) showAssistantWindow()
    wasVisibleBeforeFullscreen = false
  })
  const syncParent = () => {
    if (!assistantWin || !container || assistantWin.isDestroyed() || container.isDestroyed()) return
    if (!assistantWin.isVisible()) return
    positionWindow(savedRect ?? relativeRect(assistantWin, contentSize(container)))
  }
  win.on('move', syncParent)
  win.on('resize', syncParent)
  win.once('closed', () => destroyAssistantWindow())
  logger.info('AI 浮窗已创建（预创建隐藏；关闭=hide）')
}

export function showAssistantWindow() {
  if (!assistantWin || assistantWin.isDestroyed()) return false
  if (!assistantWin.isVisible()) {
    if (!assistantWin.webContents.isLoading()) {
      // 已加载：按记忆位置显示
      const viewport = contentSize(container as BrowserWindow)
      positionWindow(savedRect ?? defaultAssistantRect(viewport))
      assistantWin.show()
      assistantWin.focus()
    } else {
      pendingShow = true
    }
  }
  return true
}

export function hideAssistantWindow() {
  if (!assistantWin || assistantWin.isDestroyed() || !assistantWin.isVisible()) return
  saveMemory(savedRect ?? relativeRect(assistantWin, contentSize(container as BrowserWindow)))
  assistantWin.hide()
}

export function toggleAssistantWindow() {
  if (isAssistantWindowVisible()) {
    hideAssistantWindow()
    return false
  }
  showAssistantWindow()
  return true
}

export function isAssistantWindowVisible() {
  return !!assistantWin && !assistantWin.isDestroyed() && assistantWin.isVisible()
}

export function getAssistantWindowWebContents(): Electron.WebContents | null {
  return assistantWin && !assistantWin.isDestroyed() ? assistantWin.webContents : null
}

export function destroyAssistantWindow() {
  const win = assistantWin
  assistantWin = null
  container = null
  pendingShow = false
  windowManager.clearTarget('assistant')
  try {
    if (win && !win.isDestroyed()) {
      ;(win as BrowserWindow & { __allowClose?: boolean }).__allowClose = true
      win.destroy()
    }
  } catch (error) {
    logger.warn('AI 浮窗销毁失败（父窗口关闭路径，忽略）：', error)
  }
}
