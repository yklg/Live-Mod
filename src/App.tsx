import { RefreshCwIcon, TerminalIcon } from 'lucide-react'
import { Outlet } from 'react-router'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import LogDisplayer from '@/components/common/LogDisplayer'
import Sidebar from '@/components/common/Sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/toaster'
import { useDevMode } from '@/hooks/useDevMode'
import { useIpcListener } from './hooks/useIpc'
import './App.css'
import { useEffect } from 'react'
import { UpdateDialog } from './components/update/UpdateDialog'
import { useAccounts } from './hooks/useAccounts'
import { useAutoMessageStore } from './hooks/useAutoMessage'
import { useAutoPopUpStore } from './hooks/useAutoPopUp'
import { useAutoReply, useAutoReplyStore } from './hooks/useAutoReply'
import { useChromeConfigStore } from './hooks/useChromeConfig'
import { useConnectToLiveControl } from './hooks/useConnectToLiveControl'
import { useLiveControlStore } from './hooks/useLiveControl'
import { useToast } from './hooks/useToast'
import { useUpdateConfigStore, useUpdateStore } from './hooks/useUpdate'

// 导出供 rail 入口复用（光圈式壳 A1：railView=完整业务树唯一宿主；chrome 入口禁止 import 本函数）
export function useGlobalIpcListener() {
  const { handleComment } = useAutoReply()
  const { setIsListening } = useAutoReplyStore()
  const { setIsConnected, setAccountName } = useLiveControlStore()
  const setIsRunningAutoMessage = useAutoMessageStore(s => s.setIsRunning)
  const setIsRunningAutoPopUp = useAutoPopUpStore(s => s.setIsRunning)
  const setStorageState = useChromeConfigStore(s => s.setStorageState)
  const enableAutoCheckUpdate = useUpdateConfigStore(s => s.enableAutoCheckUpdate)
  const handleUpdate = useUpdateStore.use.handleUpdate()
  const { toast } = useToast()
  const { connectLiveControl } = useConnectToLiveControl()

  useIpcListener(IPC_CHANNELS.tasks.autoReply.showComment, ({ comment, accountId }) => {
    handleComment(comment, accountId)
  })

  useIpcListener(IPC_CHANNELS.tasks.liveControl.disconnectedEvent, id => {
    setIsConnected(id, 'disconnected')
    toast.error('直播控制台已断开连接')
  })

  // 直播结束自动停止：统一复位该账号全部任务开关（部分任务类型无自发 stoppedEvent）
  useIpcListener(IPC_CHANNELS.tasks.liveControl.liveEndedEvent, id => {
    setIsRunningAutoMessage(id, false)
    setIsRunningAutoPopUp(id, false)
    setIsListening(id, 'stopped')
    toast.error('直播已结束，所有任务已自动停止')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoMessage.stoppedEvent, id => {
    setIsRunningAutoMessage(id, false)
    toast.error('自动发言已停止')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoPopUp.stoppedEvent, id => {
    setIsRunningAutoPopUp(id, false)
    toast.error('自动弹窗已停止')
  })

  useIpcListener(IPC_CHANNELS.tasks.autoReply.listenerStopped, id => {
    setIsListening(id, 'stopped')
  })

  useIpcListener(IPC_CHANNELS.chrome.saveState, (id, state) => {
    setStorageState(id, state)
  })

  useIpcListener(IPC_CHANNELS.tasks.liveControl.notifyAccountName, params => {
    if (params.ok) {
      setAccountName(params.accountId, params.accountName || '')
    }
  })

  // 壳入口平台选择器（shell-entry-platform-selector v1）：入口=纯展示，rail=业务编排。
  // 选择即自动连接（复用唯一连接通道）；失败回退显示入口（入口显隐/记忆归主进程）。
  useIpcListener(IPC_CHANNELS.shell.entryIntent, intent => {
    void (async () => {
      const ok = await connectLiveControl(intent.platform)
      if (!ok) {
        void window.ipcRenderer.invoke(IPC_CHANNELS.shell.entryReopen)
      }
    })()
  })

  // rail 完整业务树就绪握手：主进程据此裁决「恢复记忆 / 显示入口」。
  // StrictMode 双调幂等（主进程侧幂等）；经典模式主进程 no-op，零副作用。
  useEffect(() => {
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railReady)
  }, [])

  useIpcListener(IPC_CHANNELS.app.notifyUpdate, info => {
    if (enableAutoCheckUpdate) {
      handleUpdate(info)
    }
  })
}

function App() {
  const { enabled: devMode } = useDevMode()
  const { accounts, currentAccountId } = useAccounts()

  useEffect(() => {
    const account = accounts.find(acc => acc.id === currentAccountId)
    if (account) {
      window.ipcRenderer.invoke(IPC_CHANNELS.account.switch, { account })
    }
  }, [accounts, currentAccountId])

  useGlobalIpcListener()

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleToggleDevTools = async () => {
    await window.ipcRenderer.invoke(IPC_CHANNELS.chrome.toggleDevTools)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger disabled={!devMode} className="flex h-full w-full overflow-hidden">
          <SidebarProvider>
            {/* 侧边栏：品牌 / 导航分组 / 账号与主题 */}
            <Sidebar />

            {/* 主内容区：页面 + 日志面板 */}
            <SidebarInset className="min-w-0">
              <div className="min-h-0 flex-1 overflow-hidden">
                <Outlet />
              </div>
              <LogDisplayer />
            </SidebarInset>
          </SidebarProvider>
          <UpdateDialog />
        </ContextMenuTrigger>
        {devMode && (
          <ContextMenuContent>
            <ContextMenuItem onClick={handleRefresh}>
              <RefreshCwIcon className="mr-2 h-4 w-4" />
              <span>刷新页面</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleToggleDevTools}>
              <TerminalIcon className="mr-2 h-4 w-4" />
              <span>开发者工具</span>
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      <Toaster />
    </>
  )
}

export default App
