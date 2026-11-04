import { SendHorizontalIcon } from 'lucide-react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useAccounts } from '@/hooks/useAccounts'
import { type MessageOf, useAutoReply } from '@/hooks/useAutoReply'

export default function PreviewList({
  setHighLight,
}: {
  setHighLight: (commentId: string | null) => void
}) {
  const { replies, comments } = useAutoReply()
  const { currentAccountId } = useAccounts()
  const handleSendReply = async (replyContent: string, _commentId: string) => {
    try {
      await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoReply.sendReply,
        currentAccountId,
        replyContent,
      )
      // removeReply(commentId)
    } catch (error) {
      console.error('发送回复失败:', error)
    }
  }

  return (
    <Card className="flex h-full flex-col shadow-sm">
      <CardHeader className="shrink-0 pb-3">
        <CardTitle>回复预览</CardTitle>
        <CardDescription>AI 生成的回复内容</CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="min-h-0 flex-1">
        <ScrollArea className="h-full py-2">
          <div className="space-y-1">
            {replies.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">暂无回复数据</div>
            ) : (
              replies.map(reply => {
                const relatedComment = comments.find(
                  c => c.msg_id === reply.commentId,
                ) as MessageOf<'comment'>
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: 不用管 a11y
                  <div
                    key={reply.commentId}
                    className="group px-3 py-1.5 text-sm hover:bg-muted/50 rounded-lg transition-colors"
                    onMouseEnter={() => setHighLight(reply.commentId)}
                    onMouseLeave={() => setHighLight(null)}
                  >
                    <div className="flex flex-col gap-1">
                      {relatedComment && (
                        <div className="text-xs text-muted-foreground">
                          回复：
                          {relatedComment.nick_name} - {relatedComment.content}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex-1 text-foreground/85">{reply.replyContent}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="invisible group-hover:visible h-6 w-6"
                          title="发送"
                          onClick={() => handleSendReply(reply.replyContent, reply.commentId)}
                        >
                          <SendHorizontalIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
