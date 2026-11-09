// 壳模式应用菜单（shell-entry-platform-selector v1 验证期用户反馈：官方中控台需要缩放）
// 为什么必须自定义：Electron 默认菜单的 Zoom 角色作用于「聚焦 BrowserWindow 的 webContents」，
// 光圈式壳里业务页在 WebContentsView（pageView）中，默认角色对壳内 Tab 无效（容器 webContents 只是壳）。
// 本菜单把缩放直达 shellUI facade（作用于当前活跃 Tab），其它菜单项保持系统常规角色。
// 壳 UI 是唯一运行形态：应用启动即安装本菜单（承载缩放/面板开合快捷键）。
import { Menu, type MenuItemConstructorOptions } from 'electron'

export interface ShellZoomControls {
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  /** 显示/隐藏右侧业务面板（面板是 overlay，会盖住官方页面右侧的评论区） */
  togglePanel: () => void
}

export function installShellMenu(controls: ShellZoomControls) {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: '显示',
      submenu: [
        { label: '放大', accelerator: 'CommandOrControl+Plus', click: controls.zoomIn },
        { label: '缩小', accelerator: 'CommandOrControl+-', click: controls.zoomOut },
        { label: '实际大小', accelerator: 'CommandOrControl+0', click: controls.zoomReset },
        { type: 'separator' },
        {
          label: '显示/隐藏业务面板',
          accelerator: 'CommandOrControl+\\',
          click: controls.togglePanel,
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
