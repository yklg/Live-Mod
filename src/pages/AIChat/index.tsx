import { TrashIcon } from 'lucide-react'
import AIModelInfo from '@/components/ai-chat/AIModelInfo'
import { APIKeyDialog } from '@/components/ai-chat/APIKeyDialog'
import { Page } from '@/components/common/Page'
import { Button } from '@/components/ui/button'
import { useAIChatStore } from '@/hooks/useAIChat'
import ChatBox from './components/ChatBox'

export default function AIChat() {
  const { messages, clearMessages } = useAIChatStore()

  return (
    <Page
      full
      title="AI 助手"
      description="与 AI 助手进行对话，获取帮助"
      actions={
        <>
          <AIModelInfo />
          <APIKeyDialog />
          <Button
            variant="ghost"
            size="sm"
            onClick={clearMessages}
            disabled={messages.length === 0}
            className="text-muted-foreground hover:text-destructive"
          >
            <TrashIcon className="mr-2 h-4 w-4" />
            清空对话
          </Button>
        </>
      }
    >
      <div className="h-full px-6 pb-5">
        <ChatBox />
      </div>
    </Page>
  )
}
