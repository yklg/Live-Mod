// 入口平台选择器视图（薄生命周期）：只做创建/显隐/首帧门/几何/销毁。
// 选择、记忆、启动裁决分别归 entrySelection / EntryStore / entryStartup；本模块不 import shellUI。
import type { BrowserWindow, WebContentsView } from 'electron'
import { createLogger } from '#/logger'
import type { Bounds } from './shellLayout'
import { loadAppEntry, makeAppView } from './viewHost'

const logger = createLogger('ShellEntryView')

let entryView: WebContentsView | null = null
let visible = false
let loaded = false
let pendingShow = false

export function attachEntryView(
  win: BrowserWindow,
  entry: { url?: string; file?: string },
  preloadPath: string,
) {
  entryView = makeAppView(preloadPath, 'entry')
  win.contentView.addChildView(entryView)
  entryView.setVisible(false)
  visible = false
  loaded = false
  pendingShow = false
  entryView.webContents.once('did-finish-load', () => {
    loaded = true
    if (pendingShow) {
      pendingShow = false
      showEntry()
    }
  })
  loadAppEntry(entryView, entry, 'entry')
  logger.info('入口视图已挂载（初始隐藏）')
}

export function relayoutEntryView(bounds: Bounds | null) {
  entryView?.setBounds(bounds ?? { x: 0, y: 0, width: 0, height: 0 })
}

export function isEntryVisible() {
  return visible
}

export function showEntry() {
  if (!entryView) return
  if (!loaded) {
    pendingShow = true
    return
  }
  entryView.setVisible(true)
  visible = true
}

/** 幂等隐藏；连 pending 一起清掉，修复 show→hide 后仍弹出的竞态。 */
export function hideEntry() {
  pendingShow = false
  visible = false
  entryView?.setVisible(false)
}

export function destroyEntryView() {
  const view = entryView
  entryView = null
  visible = false
  loaded = false
  pendingShow = false
  try {
    view?.webContents.close()
  } catch (error) {
    logger.warn('入口视图销毁失败（窗口关闭路径，忽略）：', error)
  }
}

export function getEntryWebContents() {
  return entryView?.webContents ?? null
}

export function getEntryDebug() {
  return {
    visible,
    url: entryView?.webContents.getURL() ?? '',
    bounds: entryView?.getBounds() ?? null,
  }
}
