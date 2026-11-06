// 壳右栏入口（guangquan-shell-ui-parity v3 · A1 完整业务树）
// = v3 panelView 语义迁移：providers + useGlobalIpcListener（唯一宿主，TC-E2）+ UpdateDialog + Toaster。
// 面板开合唯一真源在主进程（A2）：本树只跟随 shell:rail:state 推送渲染，图标/ESC 一律发 railToggle 请求。
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { initTheme } from '@/hooks/useTheme'
import { autoCleanupStorage } from '@/utils/storage'
import { ShellRailRoot } from './ShellRail'

autoCleanupStorage()
initTheme()

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <ShellRailRoot />
  </React.StrictMode>,
)
