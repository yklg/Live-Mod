// 壳入口选择器入口（shell-entry-platform-selector v1 · 最小树）
// 模块图铁律（对标 chrome 的 TC-E1，新增 TC-E3）：只准 import 主题/CSS/IPC channel 常量/
// 本入口组件与纯 UI 组件；禁止 import App 根、useGlobalIpcListener、任何 tasks 事件监听。
// 职责：纯展示——拉目录、发选择、跳过；连接编排在 rail 完整业务树（single connect path）。
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { initTheme } from '@/hooks/useTheme'
import { EntrySelector } from './EntrySelector'

initTheme()

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <EntrySelector />
  </React.StrictMode>,
)
