import { useMemoizedFn } from 'ahooks'
import { Page } from '@/components/common/Page'
import { TaskButton } from '@/components/common/TaskButton'
import { useAutoPopUpActions, useCurrentAutoPopUp, useShortcutListener } from '@/hooks/useAutoPopUp'
import { useTaskControl } from '@/hooks/useTaskControl'
import GoodsListCard from './components/GoodsListCard'
import PopUpSettingsCard from './components/PopUpSettingsCard'

const useAutoPopUpTaskControl = () => {
  const isRunning = useCurrentAutoPopUp(context => context.isRunning)
  const config = useCurrentAutoPopUp(context => context.config)
  const { setIsRunning } = useAutoPopUpActions()

  return useTaskControl({
    taskType: 'auto-popup',
    getIsRunning: () => isRunning,
    getConfig: () => config,
    setIsRunning,
    startSuccessMessage: '自动弹窗任务已启动',
    startFailureMessage: '自动弹窗任务启动失败',
  })
}

export default function AutoPopUp() {
  const { isRunning, onStartTask, onStopTask } = useAutoPopUpTaskControl()

  const handleTaskButtonClick = useMemoizedFn(() => {
    if (!isRunning) onStartTask()
    else onStopTask()
  })

  useShortcutListener()

  return (
    <Page
      title="自动弹窗"
      description="配置自动弹出商品的规则"
      actions={<TaskButton isTaskRunning={isRunning} onStartStop={handleTaskButtonClick} />}
    >
      <div className="grid gap-5 xl:grid-cols-[2fr_1fr] xl:items-start" data-testid="auto-grid">
        <GoodsListCard />
        <PopUpSettingsCard />
      </div>
    </Page>
  )
}
