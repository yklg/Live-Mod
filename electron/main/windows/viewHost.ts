// 壳容器视图宿主（shell-entry-platform-selector v1 抽取）
// 职责：chrome/rail/entry 三个本地壳入口视图的创建与加载路径解析——单一真源，
// 防止 dev/prod 双形态加载路径在多个入口各写一份而漂移（评审风险项）。
// 铁律：本模块只做「本地受信入口视图」，绝不给 pageView（远程官方页）使用——
// pageView 的 newView 在 shellUI 内独立创建（无 preload、无 IPC，A5）。
import path from 'node:path'
import { shell, WebContentsView } from 'electron'
import { createLogger } from '#/logger'
import { installExternalProtocolGuard } from './externalProtocolGuard'

const logger = createLogger('ShellViewHost')

export type ShellEntryName = 'chrome' | 'rail' | 'entry'

export function makeAppView(preloadPath: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: process.env.NODE_ENV === 'development',
    },
  })
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 非 http(s) 深链（bytedance: 等）一律拦截，避免 macOS「打开方式」系统弹窗
  installExternalProtocolGuard(view.webContents, msg => logger.warn(msg))
  return view
}

/** dev: `${base}/chrome.html`；prod: RENDERER_DIST 同级 chrome.html/rail.html/entry.html */
export function loadAppEntry(
  view: WebContentsView,
  entry: { url?: string; file?: string },
  name: ShellEntryName,
) {
  if (entry.url) {
    view.webContents.loadURL(`${entry.url.replace(/\/$/, '')}/${name}.html?view=${name}`)
  } else if (entry.file) {
    view.webContents.loadFile(path.join(path.dirname(entry.file), `${name}.html`), {
      query: { view: name },
    })
  }
}
