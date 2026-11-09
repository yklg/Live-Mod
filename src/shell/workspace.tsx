// workspace 入口（第二期）：工作台首页 / 窄栏。最小树，不挂业务监听。
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { initTheme } from '@/hooks/useTheme'
import { autoCleanupStorage } from '@/utils/storage'
import { WorkspaceRoot } from './WorkspaceRoot'

autoCleanupStorage()
initTheme()

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <WorkspaceRoot />
  </React.StrictMode>,
)
