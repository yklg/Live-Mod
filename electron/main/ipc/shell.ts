// 光圈式壳界面 IPC（guangquan-shell-ui-parity v3 · 3)）：全部转发 shellUI facade。
// 只有壳 UI 视图会触达这些通道；handler 内 shellUI 未就绪时抛「壳容器未就绪」（错误在正确边界暴露）。
import { BrowserWindow, session } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { typedIpcMainHandle } from '#/utils'
import {
  getEntryCatalogSnapshot,
  handleRailReady,
  hideEntry,
  reopenEntry,
  selectEntry,
} from '#/windows/entryView'
import { handleNoticeReady, pushNotice } from '#/windows/noticeBus'
import { accountTabPartition } from '#/windows/shellTabManager'
import {
  getContainer,
  isShellUIEnabled,
  shellRailToggle,
  shellTabActivate,
  shellTabBack,
  shellTabClose,
  shellTabCreate,
  shellTabForward,
  shellTabNavigate,
  shellTabReload,
  shellTabsList,
} from '#/windows/shellUI'

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.shell.tabCreate, (_, params) => shellTabCreate(params))
  typedIpcMainHandle(IPC_CHANNELS.shell.tabClose, (_, id) => shellTabClose(id))
  typedIpcMainHandle(IPC_CHANNELS.shell.tabActivate, (_, id) => shellTabActivate(id))
  typedIpcMainHandle(IPC_CHANNELS.shell.tabNavigate, async (_, id, url) => {
    await shellTabNavigate(id, url)
  })
  typedIpcMainHandle(IPC_CHANNELS.shell.tabBack, (_, id) => shellTabBack(id))
  typedIpcMainHandle(IPC_CHANNELS.shell.tabForward, (_, id) => shellTabForward(id))
  typedIpcMainHandle(IPC_CHANNELS.shell.tabReload, (_, id) => shellTabReload(id))
  typedIpcMainHandle(IPC_CHANNELS.shell.tabsList, () => shellTabsList())
  typedIpcMainHandle(IPC_CHANNELS.shell.railToggle, (_, routeId) => shellRailToggle(routeId))
  typedIpcMainHandle(IPC_CHANNELS.shell.uiStatus, () => isShellUIEnabled())

  // ---- 壳入口平台选择器（shell-entry-platform-selector v1）----
  // 入口=纯展示：目录/记忆快照由主进程下发，选择/跳过只回主进程；连接编排在 rail 业务树（entryIntent）
  typedIpcMainHandle(IPC_CHANNELS.shell.entryCatalog, () => getEntryCatalogSnapshot())
  typedIpcMainHandle(IPC_CHANNELS.shell.entrySelect, (_, params) =>
    selectEntry(params.platform, params.remember, isShellUIEnabled()),
  )
  typedIpcMainHandle(IPC_CHANNELS.shell.entrySkip, () => hideEntry())
  typedIpcMainHandle(IPC_CHANNELS.shell.entryReopen, () => {
    if (isShellUIEnabled()) reopenEntry()
  })
  typedIpcMainHandle(IPC_CHANNELS.shell.railReady, () => {
    if (!isShellUIEnabled()) return
    handleRailReady()
  })

  // ---- 壳级通知层（shell-ui-polish v3）----
  // notify：rail 业务树 toast 请求 → 主进程校验/缓冲 → 壳级通知覆盖层
  typedIpcMainHandle(IPC_CHANNELS.shell.notify, (_, payload) => ({ ok: pushNotice(payload) }))
  typedIpcMainHandle(IPC_CHANNELS.shell.noticeReady, () => {
    if (!isShellUIEnabled()) return
    handleNoticeReady()
  })

  // v3·P1：attach 模式登录态活在账号 Tab partition——重置必须清它（partition 名与 tabManager 同源）
  typedIpcMainHandle(IPC_CHANNELS.shell.resetLoginState, async (_, accountId) => {
    await session.fromPartition(accountTabPartition(accountId)).clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
    })
  })

  typedIpcMainHandle(IPC_CHANNELS.shell.windowMinimize, () => {
    getContainer()?.minimize()
  })
  typedIpcMainHandle(IPC_CHANNELS.shell.windowMaximize, () => {
    const win = getContainer()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  typedIpcMainHandle(IPC_CHANNELS.shell.windowClose, () => {
    // 关闭容器=退出（v3 语义不变）；关 pageView≠退出
    const win = getContainer() ?? BrowserWindow.getAllWindows()[0]
    win?.close()
  })
}

export function setupShellIpcHandlers() {
  setupIpcHandlers()
}
