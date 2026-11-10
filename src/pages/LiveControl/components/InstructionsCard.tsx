import { ChevronDown } from 'lucide-react'
import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { isShellPanelView } from '@/shell/lib/panelMode'

const instructions = [
  '选择平台并点击"连接直播控制台"按钮，等待登录',
  '登录成功后，即可使用自动发言和自动弹窗功能',
  '自动回复功能目前仅对抖音小店和巨量百应开放',
]

const InstructionSteps = React.memo(() => (
  <div>
    {instructions.map((instruction, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: 下标无妨
      <div className="relative flex gap-3 pb-5 last:pb-0" key={index}>
        {index < instructions.length - 1 && (
          <span
            aria-hidden="true"
            className="absolute top-7 left-3 h-[calc(100%-1.75rem)] w-px bg-border"
          />
        )}
        <div className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <span className="text-xs font-semibold text-primary">{index + 1}</span>
        </div>
        <p className="pt-0.5 text-sm leading-6 text-muted-foreground">{instruction}</p>
      </div>
    ))}
  </div>
))

const InstructionsCard = React.memo(() => {
  // 壳面板：常驻大卡 → 默认收起折叠行（C3）；经典模式保持原卡片（D6 零变化）
  if (isShellPanelView()) {
    return (
      <Collapsible data-testid="usage-fold">
        <CollapsibleTrigger className="group/usage flex w-full items-center gap-2.5 rounded-card border-hairline border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
          <span className="text-[13px] font-medium">使用说明</span>
          <span className="text-xs text-muted-foreground">3 步上手</span>
          <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]/usage:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-card border-hairline border-border bg-card px-3 py-3">
          <InstructionSteps />
        </CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>使用说明</CardTitle>
        <CardDescription>了解如何使用直播控制台</CardDescription>
      </CardHeader>
      <CardContent>
        <InstructionSteps />
      </CardContent>
    </Card>
  )
})

export default InstructionsCard
