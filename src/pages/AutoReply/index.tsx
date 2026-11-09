import { MessagesSquare, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { autoReplyPlatforms } from '@/abilities'
import { EmptyState } from '@/components/common/EmptyState'
import { Page } from '@/components/common/Page'
import { TaskButton } from '@/components/common/TaskButton'
import { Button } from '@/components/ui/button'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import CommentList from '@/pages/AutoReply/components/CommentList'
import PreviewList from '@/pages/AutoReply/components/PreviewList'

export default function AutoReply() {
  const { isRunning, setIsRunning } = useAutoReply()
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)

  const handleAutoReplyToggle = async () => {
    try {
      setIsRunning(!isRunning)
    } catch (error) {
      console.error('切换自动回复失败:', error)
    }
  }

  const navigate = useNavigate()

  const platform = useCurrentLiveControl(context => context.platform)
  if (!autoReplyPlatforms.includes(platform)) {
    return (
      <Page title="自动回复" description="查看直播间的实时评论并自动回复">
        <EmptyState
          className="min-h-[320px]"
          icon={MessagesSquare}
          title="当前平台暂不支持自动回复"
          description="自动回复目前支持抖音小店、巨量百应、视频号和小红书。切换平台后再试。"
        />
      </Page>
    )
  }

  return (
    <Page
      full
      title="自动回复"
      description="查看直播间的实时评论并自动回复"
      actions={
        <>
          {/* 用户屏蔽列表 */}
          <Button variant="outline" onClick={() => navigate('settings')} title="设置">
            <Settings2 className="h-4 w-4" />
            <span>设置</span>
          </Button>
          <TaskButton isTaskRunning={isRunning} onStartStop={handleAutoReplyToggle} />
        </>
      }
    >
      {/* 评论和回复区域：填满剩余高度 */}
      <div className="grid h-full grid-cols-2 gap-4 px-6 pb-5 @xl/panel:gap-3 @xl/panel:px-4 @xl/panel:pb-4">
        {/* 评论列表卡片 */}
        <CommentList highlight={highlightedCommentId} />

        {/* 回复预览卡片 */}
        <PreviewList setHighLight={setHighlightedCommentId} />
      </div>
    </Page>
  )
}
