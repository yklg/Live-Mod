import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { buildConnectPayload } from '@/pages/LiveControl/lib/connectPayload'
import { useAccounts } from './useAccounts'
import { useCurrentChromeConfig } from './useChromeConfig'
import { useCurrentLiveControl, useCurrentLiveControlActions } from './useLiveControl'
import { useToast } from './useToast'

/**
 * 壳 UI 形态查询（v3）：invoke 失败视为 false（经典保守语义，计划 Assumptions 声明）。
 * uiStatus 切换需重启应用，mount 一次性查询无漂移风险。
 */
export function useShellUiStatus() {
  const [uiStatus, setUiStatus] = useState(false)
  useEffect(() => {
    void (async () => {
      try {
        setUiStatus(await window.ipcRenderer.invoke(IPC_CHANNELS.shell.uiStatus))
      } catch {
        setUiStatus(false)
      }
    })()
  }, [])
  return uiStatus
}

/**
 * 连接/断开编排唯一实现（计划 Proposed Changes 6 · 业务树编排复用）：
 * - 面板 StatusCard 连接按钮（经典 / 壳 UI 同一路径）
 * - App.useGlobalIpcListener 的壳入口 entryIntent（选择即自动连接，失败回退入口）
 *
 * payload 构造收敛到纯函数 buildConnectPayload（含 taobao 强制 headless=false 与
 * v3 形态隔离 mode 映射）；本 hook 只负责账号、状态机与 toast，不复制连接细节。
 * 返回值 boolean 供入口意图判定是否回退显示入口（成功 true / 失败 false）。
 */
export function useConnectToLiveControl() {
  const account = useAccounts(store => store.getCurrentAccount())
  const platform = useCurrentLiveControl(context => context.platform)
  const { setIsConnected, setPlatform } = useCurrentLiveControlActions()
  const chromePath = useCurrentChromeConfig(context => context.path)
  const storageState = useCurrentChromeConfig(context => context.storageState)
  const shellMode = useCurrentChromeConfig(context => context.shellMode ?? false)
  const forceExternal = useCurrentChromeConfig(context => context.forceExternal ?? false)
  const headless = useCurrentChromeConfig(context => context.headless)
  const uiStatus = useShellUiStatus()
  const { toast } = useToast()

  const connectLiveControl = useMemoizedFn(
    async (platformOverride?: LiveControlPlatform): Promise<boolean> => {
      if (!account) {
        toast.error('找不到对应账号')
        return false
      }
      // 入口意图携带平台：先写入 store，保证面板/平台选择器显示与实际连接平台一致
      if (platformOverride) {
        setPlatform(platformOverride)
      }
      setIsConnected('connecting')
      try {
        const payload = buildConnectPayload({
          platform: platformOverride ?? platform,
          account,
          headless,
          chromePath,
          storageState,
          uiStatus,
          forceExternal,
          shellMode,
        })
        const result = await window.ipcRenderer.invoke(
          IPC_CHANNELS.tasks.liveControl.connect,
          payload,
        )
        if (!result) {
          throw new Error('连接直播控制台失败')
        }
        setIsConnected('connected')
        toast.success('已连接到直播控制台')
        return true
      } catch (error) {
        setIsConnected('disconnected')
        toast.error(error instanceof Error ? error.message : '连接直播控制台失败')
        return false
      }
    },
  )

  const disconnectLiveControl = useMemoizedFn(async (): Promise<void> => {
    if (!account) {
      toast.error('找不到对应账号')
      return
    }
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, account.id)
      toast.success('已断开连接')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '断开连接失败')
    } finally {
      setIsConnected('disconnected')
    }
  })

  return useMemo(
    () => ({ connectLiveControl, disconnectLiveControl }),
    [connectLiveControl, disconnectLiveControl],
  )
}
