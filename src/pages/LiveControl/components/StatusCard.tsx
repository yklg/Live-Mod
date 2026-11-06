import { useMemoizedFn } from 'ahooks'
import { CheckIcon, CircleAlert, GlobeIcon, XIcon } from 'lucide-react'
import React, { useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useCurrentChromeConfig, useCurrentChromeConfigActions } from '@/hooks/useChromeConfig'
import { useConnectToLiveControl, useShellUiStatus } from '@/hooks/useConnectToLiveControl'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import PlatformSelect from './PlatformSelect'

const StatusAlert = React.memo(() => {
  const platform = useCurrentLiveControl(state => state.platform)
  if (platform === 'wxchannel') {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>你选择了视频号平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>再连接中控台
            </li>
            <li>
              视频号助手无法<strong>一号多登</strong>，在别处登录视频号助手会
              <strong>中断连接</strong>!
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  if (platform === 'taobao') {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>你选择了淘宝平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>
              再连接中控台，因为进入淘宝中控台需要获取<strong>直播间ID</strong>
            </li>
            <li>
              目前淘宝会触发人机验证，所以将<strong>强制关闭无头模式</strong>
              ，除了登录和人机验证之外请尽量不要操作浏览器
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  return null
})

const StatusCard = React.memo(() => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>控制台状态</CardTitle>
        <CardDescription>查看并管理直播控制台的连接状态</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <ConnectState />
            <div className="flex items-center gap-2">
              <PlatformSelect />
              <PlatformSwitchButton />
              <ConnectToLiveControl />
            </div>
          </div>
          <StatusAlert />
          <Separator />
          <HeadlessSetting />
          <ShellModeSetting />
        </div>
      </CardContent>
    </Card>
  )
})

/**
 * 壳 UI 专属「切换平台」：重新打开入口平台选择器（入口显隐/记忆归主进程，幂等）。
 * 经典模式无入口视图，不渲染；已连接（含连接中）时禁用，需先断开（计划 §6）。
 */
const PlatformSwitchButton = React.memo(() => {
  const uiStatus = useShellUiStatus()
  const isConnected = useCurrentLiveControl(context => context.isConnected)

  if (!uiStatus) {
    return null
  }

  const disabled = isConnected !== 'disconnected'
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      title={disabled ? '请先断开连接' : '重新选择要连接的平台'}
      onClick={() => {
        void window.ipcRenderer.invoke(IPC_CHANNELS.shell.entryReopen)
      }}
    >
      切换平台
    </Button>
  )
})

const ConnectToLiveControl = React.memo(() => {
  const { connectLiveControl, disconnectLiveControl } = useConnectToLiveControl()
  const isConnected = useCurrentLiveControl(context => context.isConnected)

  const handleButtonClick = useMemoizedFn(() => {
    if (isConnected === 'connected') {
      disconnectLiveControl()
    } else {
      connectLiveControl()
    }
  })

  return isConnected === 'connected' ? (
    <DisconnectButton handleButtonClick={handleButtonClick} />
  ) : (
    <ConnectButton isLoading={isConnected === 'connecting'} handleButtonClick={handleButtonClick} />
  )
})

const ConnectButton = React.memo(
  ({ isLoading, handleButtonClick }: { isLoading: boolean; handleButtonClick: () => void }) => {
    return (
      <Button variant={'default'} onClick={handleButtonClick} disabled={isLoading} size="sm">
        <GlobeIcon className="mr-2 h-4 w-4" />
        {isLoading ? '连接中...' : '连接直播控制台'}
      </Button>
    )
  },
)

const DisconnectButton = React.memo(({ handleButtonClick }: { handleButtonClick: () => void }) => {
  const [isHovered, setIsHovered] = useState(false)
  return (
    <Button
      variant="secondary"
      onClick={handleButtonClick}
      size="sm"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isHovered ? (
        <>
          <XIcon className="mr-2 h-4 w-4" />
          断开连接
        </>
      ) : (
        <>
          <CheckIcon className="mr-2 h-4 w-4" />
          已连接
        </>
      )}
    </Button>
  )
})

const ConnectState = React.memo(() => {
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const accountName = useCurrentLiveControl(context => context.accountName)
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          isConnected === 'connected' ? 'bg-success' : 'bg-muted-foreground/30'
        }`}
      />
      <span className="text-sm font-medium">
        {isConnected === 'connected' ? (
          `已连接${accountName ? `（${accountName}）` : ''}`
        ) : (
          <span className="text-muted-foreground">未连接</span>
        )}
      </span>
    </div>
  )
})

const HeadlessSetting = () => {
  const headless = useCurrentChromeConfig(context => context.headless ?? false)
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const { setHeadless } = useCurrentChromeConfigActions()
  return (
    <div className="flex justify-between items-center">
      <div>
        <div className="text-sm">无头模式</div>
        <div className="text-muted-foreground text-xs">
          开启后浏览器将在后台运行，不会在桌面显示
        </div>
      </div>
      <Switch
        checked={headless && platform !== 'taobao'}
        disabled={platform === 'taobao' || isConnected !== 'disconnected'}
        onCheckedChange={v => setHeadless(v)}
      />
    </div>
  )
}

const ShellModeSetting = () => {
  const shellMode = useCurrentChromeConfig(context => context.shellMode ?? false)
  const forceExternal = useCurrentChromeConfig(context => context.forceExternal ?? false)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const { setShellMode, setForceExternal } = useCurrentChromeConfigActions()
  const uiStatus = useShellUiStatus()

  // v3 形态隔离：壳 UI 下开关语义为「强制外部浏览器（调试用）」逃生口；经典模式维持实验开关原语义
  if (uiStatus) {
    return (
      <div className="flex justify-between items-center">
        <div>
          <div className="text-sm">强制外部浏览器（调试用）</div>
          <div className="text-muted-foreground text-xs">
            连接默认在壳内浏览器登录（抖音系）；开启后改由外部 Chrome/Edge 承载
          </div>
        </div>
        <Switch
          checked={forceExternal}
          disabled={isConnected !== 'disconnected'}
          onCheckedChange={v => setForceExternal(v)}
        />
      </div>
    )
  }
  return (
    <div className="flex justify-between items-center">
      <div>
        <div className="text-sm">壳模式（实验）</div>
        <div className="text-muted-foreground text-xs">
          在应用内壳窗口中打开中控台并由其驱动，无需独立浏览器；若平台异常将自动回退经典模式
        </div>
      </div>
      <Switch
        checked={shellMode}
        disabled={isConnected !== 'disconnected'}
        onCheckedChange={v => setShellMode(v)}
      />
    </div>
  )
}

export default StatusCard
