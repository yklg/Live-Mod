import { setupAIChatIpcHandlers } from './aichat'
import { setupAppIpcHandlers } from './app'
import { setupAutoMessageIpcHandlers } from './autoMessage'
import { setupAutoPopUpIpcHandlers } from './autoPopUp'
import { setupBrowserIpcHandlers } from './browser'
import { setupCommentBackendIpcHandlers } from './commentBackend'
import { setupAutoReplyIpcHandlers } from './commentListener'
import { setupLiveControlIpcHandlers } from './connection'
import { setupPinCommentIpcHandler } from './pinComment'
import { setupRedPacketIpcHandlers } from './redPacket'
import { setupShellIpcHandlers } from './shell'
import { setupUpdateIpcHandlers } from './update'

// 默认判定器在 app.ts 装配层注册（见 urlTrustResolver 注释：判定逻辑不进 ipc/ 目录）

setupLiveControlIpcHandlers()
setupAIChatIpcHandlers()
setupAutoPopUpIpcHandlers()
setupAutoReplyIpcHandlers()
setupAutoMessageIpcHandlers()
setupBrowserIpcHandlers()
setupAppIpcHandlers()
setupUpdateIpcHandlers()
setupPinCommentIpcHandler()
setupRedPacketIpcHandlers()
setupShellIpcHandlers()
setupCommentBackendIpcHandlers()
