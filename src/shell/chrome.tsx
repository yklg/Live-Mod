// 壳顶栏入口（guangquan-shell-ui-parity v3 · A1 最小树）
// 模块图铁律：只准 import 主题/CSS/IPC 类型与 ShellChrome；
// 禁止 import App 根、useGlobalIpcListener、任何 tasks 事件监听（TC-E1 构建级物理防线）。
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { initTheme } from '@/hooks/useTheme'
import ShellChrome from './ShellChrome'

initTheme()

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <ShellChrome />
  </React.StrictMode>,
)
