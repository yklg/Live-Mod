import { Page } from '@/components/common/Page'
import { SettingsLayout } from '@/components/common/SettingsLayout'
import { AccountSetting } from '@/pages/SettingsPage/components/AccountSetting'
import { AppearanceSetting } from '@/pages/SettingsPage/components/AppearanceSetting'
import { BrowserSetting } from '@/pages/SettingsPage/components/BrowserSetting'
import { DevSetting } from '@/pages/SettingsPage/components/DevSetting'
import { OtherSetting } from '@/pages/SettingsPage/components/OtherSetting'
import { UpdateSetting } from '@/pages/SettingsPage/components/UpdateSetting'

export default function Settings() {
  const sections = [
    { id: 'browser', label: '浏览器设置', content: <BrowserSetting /> },
    { id: 'appearance', label: '外观', content: <AppearanceSetting /> },
    { id: 'update', label: '软件更新', content: <UpdateSetting /> },
    { id: 'account', label: '账号管理', content: <AccountSetting /> },
    { id: 'dev', label: '开发者', content: <DevSetting /> },
    { id: 'other', label: '其他', content: <OtherSetting /> },
  ]

  return (
    <Page title="应用设置" description="管理您的应用程序设置和偏好">
      <SettingsLayout sections={sections} />
    </Page>
  )
}
