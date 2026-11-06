// 壳级通知覆盖层入口（shell-ui-polish v3 · 最小树）
// 铁律（TC-E4）：只 import shared channels + 通知渲染自身；禁止业务 hooks / tasks 监听 / App 根。
// 承载窗口为透明子窗口：html/body 必须透明，否则会绘制白底遮挡页面。
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { initTheme } from '@/hooks/useTheme'
import { NoticeHost } from './NoticeHost'

initTheme()
document.documentElement.style.setProperty('background', 'transparent')
document.body.style.setProperty('background', 'transparent')

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <NoticeHost />
  </React.StrictMode>,
)
