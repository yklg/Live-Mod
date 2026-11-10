// rail 业务树的全局 IPC 监听唯一宿主（原 src/App.tsx 迁出；经典树已移除）。
import { useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useAccounts } from './useAccounts'
import { useAutoMessageStore } from './useAutoMessage'
import { useAutoPopUpStore } from './useAutoPopUp'
import { useAutoReply, useAutoReplyStore } from './useAutoReply'
import { useChromeConfigStore } from './useChromeConfig'
import { useConnectToLiveControl } from './useConnectToLiveControl'
import { useIpcListener } from './useIpc'
import { useLiveControlStore } from './useLiveControl'
import { useToast } from './useToast'
import { useUpdateConfigStore, useUpdateStore } from './useUpdate'

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
  const accountsHydrated = useAccounts(s => s.hydrated)

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

  // 工作台平台卡/入口意图：连接编排仍在 rail 业务树（唯一连接通道）；失败回工作台。
  useIpcListener(IPC_CHANNELS.shell.entryIntent, intent => {
    void (async () => {
      const ok = await connectLiveControl(intent.platform)
      if (!ok) {
        void window.ipcRenderer.invoke(IPC_CHANNELS.shell.entryReopen)
      }
    })()
  })

  // rail 完整业务树就绪握手：主进程据此裁决「工作台 / 自动进 live」。
  // 必须等账号 hydration 完成：否则 autoRestore 会用默认账号连接。
  useEffect(() => {
    if (!accountsHydrated) return
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.railReady)
  }, [accountsHydrated])

  useIpcListener(IPC_CHANNELS.app.notifyUpdate, info => {
    if (enableAutoCheckUpdate) {
      handleUpdate(info)
    }
  })
}
