import { useMemoizedFn } from 'ahooks'
import { ArrowLeftRight, CheckIcon, ChevronDown, CircleAlert, GlobeIcon, XIcon } from 'lucide-react'
import React, { useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentChromeConfig, useCurrentChromeConfigActions } from '@/hooks/useChromeConfig'
import { useConnectToLiveControl, useShellUiStatus } from '@/hooks/useConnectToLiveControl'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { isShellPanelView } from '@/shell/lib/panelMode'
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
    <Card data-testid="status-card">
      <CardHeader>
        <CardTitle>控制台状态</CardTitle>
        <CardDescription>查看并管理直播控制台的连接状态</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between @xl/panel:flex-wrap @xl/panel:gap-2">
            <ConnectState />
            <div className="flex items-center gap-2">
              <PlatformSelect />
              <PlatformSwitchButton />
              <ConnectToLiveControl />
            </div>
          </div>
          <StatusAlert />
          <Separator />
          <AdvancedSettings />
        </div>
      </CardContent>
    </Card>
  )
})

const AdvancedSettings = React.memo(() => {
  // 壳面板：低频设置收进「高级设置」折叠（C4）；经典模式保持两行常驻（D6 零变化）
  if (isShellPanelView()) {
    return (
      <Collapsible data-testid="advanced-fold">
        <CollapsibleTrigger className="group/adv flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            高级
          </span>
          <span className="text-[13px] font-medium">高级设置</span>
          <span className="text-xs text-muted-foreground">无头模式 · 强制外部浏览器</span>
          <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]/adv:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3 rounded-lg border px-3 py-3">
          <HeadlessSetting />
          <ShellModeSetting />
        </CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <>
      <HeadlessSetting />
      <ShellModeSetting />
    </>
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
  const label = disabled ? '请先断开连接' : '切换平台'
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            data-testid="platform-switch"
            aria-label={label}
            disabled={disabled}
            onClick={() => {
              void window.ipcRenderer.invoke(IPC_CHANNELS.shell.entryReopen)
            }}
          >
            <ArrowLeftRight className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

/**
 * 「强制外部浏览器」逃生口（调试/风控兜底）：壳 UI 是唯一运行形态后，这是连接方式唯一的用户可见开关。
 * 旧经典模式的「壳模式（实验）」开关随经典模式一并移除 —— 壳内登录已是默认链路。
 */
const ShellModeSetting = () => {
  const forceExternal = useCurrentChromeConfig(context => context.forceExternal ?? false)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const { setForceExternal } = useCurrentChromeConfigActions()

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

export default StatusCard
