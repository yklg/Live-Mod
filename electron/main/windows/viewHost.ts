// 壳容器视图宿主（shell-entry-platform-selector v1 抽取）
// 职责：chrome/rail/entry 三个本地壳入口视图的创建与加载路径解析——单一真源，
// 防止 dev/prod 双形态加载路径在多个入口各写一份而漂移（评审风险项）。
// 铁律：本模块只做「本地受信入口视图」，绝不给 pageView（远程官方页）使用——
// pageView 的 newView 在 shellUI 内独立创建（无 preload、无 IPC，A5）。
import path from 'node:path'
import { shell, WebContentsView } from 'electron'
import { buildNoticeTestMsArg, buildShellViewArg } from 'shared/shellView'
import { createLogger } from '#/logger'
import { installExternalProtocolGuard } from './externalProtocolGuard'

const logger = createLogger('ShellViewHost')

export type ShellEntryName = 'chrome' | 'rail' | 'entry' | 'notice'

/** 通知停留时长的测试覆盖（仅 LM_SHELL_DEBUG=1 且显式 env 时注入，生产无覆盖） */
function noticeTestArgs(name: ShellEntryName): string[] {
  if (name !== 'notice') return []
  const raw = process.env.LM_SHELL_NOTICE_TEST_MS
  if (process.env.LM_SHELL_DEBUG !== '1' || !raw) return []
  const ms = Number(raw)
  return Number.isFinite(ms) && ms > 0 ? [buildNoticeTestMsArg(ms)] : []
}

export function makeAppView(
  preloadPath: string,
  viewName: ShellViewName = 'index',
): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: process.env.NODE_ENV === 'development',
      // 壳模式同步判定：preload 从 argv 读 --lm-view，渲染层任何模块执行前即可知（消除启动竞态）
      additionalArguments: [
        buildShellViewArg(viewName),
        ...noticeTestArgs(viewName as ShellEntryName),
      ],
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
/** 承载者只需要 webContents（WebContentsView / BrowserWindow 通用 —— notice 用透明子窗口） */
export type AppEntryCarrier = { webContents: Electron.WebContents }

export function loadAppEntry(
  view: AppEntryCarrier,
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
