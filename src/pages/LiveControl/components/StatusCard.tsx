import { useMemoizedFn } from 'ahooks'
import { ArrowLeftRight, ChevronDown, CircleAlert, GlobeIcon, XIcon } from 'lucide-react'
import React from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { PanelRow, PanelSection, PanelSummary } from '@/components/common/Panel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentChromeConfig, useCurrentChromeConfigActions } from '@/hooks/useChromeConfig'
import { useConnectToLiveControl, useShellUiStatus } from '@/hooks/useConnectToLiveControl'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { isShellPanelView } from '@/shell/lib/panelMode'
import PlatformSelect, { platformLabel } from './PlatformSelect'

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

const ConnectionSummary = React.memo(() => {
  const platform = useCurrentLiveControl(context => context.platform)
  const accountName = useCurrentLiveControl(context => context.accountName)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const label = platformLabel(platform)
  return (
    <PanelSummary
      icon={
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-primary text-[12px] font-semibold text-primary-foreground">
          {label.slice(0, 1)}
        </span>
      }
      title={accountName ? `${label} · ${accountName}` : label}
      subtitle={
        <span className="inline-flex items-center gap-1">
          <span
            className={`size-1.5 rounded-full ${
              isConnected === 'connected' ? 'bg-success' : 'bg-muted-foreground/30'
            }`}
          />
          {isConnected === 'connected'
            ? '已连接 · 可开始任务'
            : isConnected === 'connecting'
              ? '连接中…'
              : '未连接'}
        </span>
      }
      action={
        <div className="flex items-center gap-1">
          <PlatformSwitchButton />
          <ConnectToLiveControl compact />
        </div>
      }
    />
  )
})

const StatusCard = React.memo(() => {
  return (
    <div className="flex flex-col gap-2.5" data-testid="status-card">
      <ConnectionSummary />
      <StatusAlert />
      <PanelSection label="连接">
        <PanelRow>
          <span className="w-10 shrink-0 text-[11px] text-muted-foreground">平台</span>
          <PlatformSelect />
        </PanelRow>
        <p className="pt-1 text-[11px] text-muted-foreground">壳内登录；视频号请先开播再连接。</p>
      </PanelSection>
      <PanelSection label="运行">
        <div className="divide-y divide-border/70">
          <div className="py-2">
            <HeadlessSetting />
          </div>
          <div className="py-2">
            <ShellModeSetting />
          </div>
        </div>
      </PanelSection>
      <AdvancedSettings />
    </div>
  )
})

const AdvancedSettings = React.memo(() => {
  // 壳面板：低频设置收进「高级设置」折叠（C4）；经典模式保持两行常驻（D6 零变化）
  if (isShellPanelView()) {
    return (
      <Collapsible data-testid="advanced-fold">
        <CollapsibleTrigger className="group/adv flex w-full items-center gap-2.5 rounded-card border-hairline border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            高级
          </span>
          <span className="text-[13px] font-medium">高级设置</span>
          <span className="text-xs text-muted-foreground">无头模式 · 强制外部浏览器</span>
          <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]/adv:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3 rounded-card border-hairline border-border bg-card px-3 py-3">
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

const ConnectToLiveControl = React.memo(({ compact = false }: { compact?: boolean }) => {
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
    <DisconnectButton compact={compact} handleButtonClick={handleButtonClick} />
  ) : (
    <ConnectButton
      compact={compact}
      isLoading={isConnected === 'connecting'}
      handleButtonClick={handleButtonClick}
    />
  )
})

const ConnectButton = React.memo(
  ({
    isLoading,
    handleButtonClick,
    compact = false,
  }: {
    isLoading: boolean
    handleButtonClick: () => void
    compact?: boolean
  }) => {
    return (
      <Button
        data-testid="connect-live"
        variant={'default'}
        onClick={handleButtonClick}
        disabled={isLoading}
        size="sm"
      >
        <GlobeIcon className="size-3.5" />
        {isLoading ? '连接中...' : compact ? '连接' : '连接直播控制台'}
      </Button>
    )
  },
)

const DisconnectButton = React.memo(
  ({
    handleButtonClick,
    compact = false,
  }: {
    handleButtonClick: () => void
    compact?: boolean
  }) => {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="secondary" size="sm">
            {!compact && <XIcon className="size-3.5" />}
            断开
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认断开直播控制台？</AlertDialogTitle>
            <AlertDialogDescription>
              断开后，自动发言、自动回复、自动弹窗将无法继续驱动当前中控台。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleButtonClick}>确认断开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  },
)

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
