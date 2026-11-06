import { useMemoizedFn } from 'ahooks'
import { useState } from 'react'
import { Page } from '@/components/common/Page'
import { TaskButton } from '@/components/common/TaskButton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAutoMessageActions, useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useTaskControl } from '@/hooks/useTaskControl'
import MessageListCard from './components/MessageListCard'
import MessageSettingsCard from './components/MessageSettingsCard'
import { MessageOneKey } from './components/MessagesOneKey'

const useAutoMessageTaskControl = () => {
  const isRunning = useCurrentAutoMessage(context => context.isRunning)
  const config = useCurrentAutoMessage(context => context.config)
  const { setIsRunning } = useAutoMessageActions()

  return useTaskControl({
    taskType: 'auto-comment',
    getIsRunning: () => isRunning,
    getConfig: () => config,
    setIsRunning,
    startSuccessMessage: '自动消息任务已启动',
    startFailureMessage: '自动消息任务启动失败',
  })
}

export default function AutoMessage() {
  const { isRunning, onStartTask, onStopTask } = useAutoMessageTaskControl()
  const [validationError] = useState<string | null>(null)

  const handleTaskButtonClick = useMemoizedFn(() => {
    if (!isRunning) onStartTask()
    else onStopTask()
  })

  return (
    <Page
      title="自动发言"
      description="配置自动发送消息的规则"
      actions={<TaskButton isTaskRunning={isRunning} onStartStop={handleTaskButtonClick} />}
    >
      {validationError && (
        <Alert variant="destructive">
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[2fr_1fr] xl:items-start" data-testid="auto-grid">
        <MessageListCard />
        <div className="grid gap-5">
          <MessageSettingsCard />
          <MessageOneKey />
        </div>
      </div>
    </Page>
  )
}
