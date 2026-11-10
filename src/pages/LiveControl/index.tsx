import { Page } from '@/components/common/Page'
import InstructionsCard from './components/InstructionsCard'
import StatusCard from './components/StatusCard'

export default function BrowserControl() {
  return (
    <Page title="直播控制台" description="连接并管理您的直播控制台">
      <div className="space-y-2.5">
        <StatusCard />
        <InstructionsCard />
      </div>
    </Page>
  )
}
