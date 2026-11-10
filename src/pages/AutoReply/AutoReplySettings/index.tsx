import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Page } from '@/components/common/Page'
import { SettingsLayout } from '@/components/common/SettingsLayout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { AIReplySetting } from './components/AIReplySetting'
import { BlocklistManager } from './components/BlocklistManager'
import { CompassSetting } from './components/CompassSetting'
import { HideUsernameSetting } from './components/HideUsernameSetting'
import { KeywordReplySetting } from './components/KeywordReplySetting'
import { ListeningSourceSetting } from './components/ListeningSourceSetting'
import { WebSocketSetting } from './components/WebSocketSetting'
import { WechatChannelSetting } from './components/WechatChannelSetting'

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-3">{children}</CardContent>
    </Card>
  )
}

export default function AutoReplySettings() {
  const { config } = useAutoReplyConfig()
  const navigate = useNavigate()

  const ExtraSetting = useMemo(() => {
    switch (config.entry) {
      case 'compass':
        return <CompassSetting />
      case 'wechat-channel':
        return <WechatChannelSetting />
      default:
        return null
    }
  }, [config.entry])

  const sections = useMemo(() => {
    const list = [
      {
        id: 'listening-source',
        label: '监听来源',
        content: (
          <SectionCard>
            <ListeningSourceSetting />
          </SectionCard>
        ),
      },
      {
        id: 'comment-filter',
        label: '评论过滤',
        content: (
          <SectionCard>
            <HideUsernameSetting />
          </SectionCard>
        ),
      },
      {
        id: 'keyword-ai',
        label: '关键词与 AI',
        content: (
          <SectionCard>
            <Tabs defaultValue="keyword">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">自动回复评论设置</h3>
                <TabsList>
                  <TabsTrigger value="keyword">关键词回复</TabsTrigger>
                  <TabsTrigger value="ai">AI回复</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="keyword" className="space-y-4">
                <KeywordReplySetting />
              </TabsContent>
              <TabsContent value="ai" className="space-y-4">
                <AIReplySetting />
              </TabsContent>
            </Tabs>
          </SectionCard>
        ),
      },
    ]
    if (ExtraSetting) {
      list.push({
        id: 'event-reply',
        label: '事件回复',
        content: <SectionCard>{ExtraSetting}</SectionCard>,
      })
    }
    list.push(
      {
        id: 'blocklist',
        label: '黑名单',
        content: (
          <SectionCard>
            <BlocklistManager />
          </SectionCard>
        ),
      },
      {
        id: 'websocket',
        label: 'WebSocket 服务',
        content: (
          <SectionCard>
            <WebSocketSetting />
          </SectionCard>
        ),
      },
    )
    return list
  }, [ExtraSetting])

  return (
    <Page
      title="自动回复设置"
      description="配置自动回复的行为和监听来源"
      back={() => navigate(-1)}
      actions={<Badge variant="secondary">设置会自动保存</Badge>}
    >
      <SettingsLayout sections={sections} />
      <Separator className="my-6" />
      <p className="text-xs text-muted-foreground">修改后立即生效并自动保存，无需手动保存</p>
    </Page>
  )
}
