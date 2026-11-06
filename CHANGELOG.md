# Changelog

## Unreleased

### 🚀 Features

- 光圈式壳界面：新增 chrome（顶栏）/ rail（右栏）双入口，壳内 Tab 统一管理（新建/关闭/切换/前进后退/刷新），右栏功能面板开合与「离开中控页」任务护栏，几何与面板状态由主进程单一真源裁决
- 壳内登录默认化：壳 UI 形态下抖音小店/巨量百应连接默认在壳内 Tab 完成登录（attach），无需逐账号实验开关；新增「强制外部浏览器（调试用）」逃生口（与经典模式「壳模式」开关形态隔离互不生效）；attach 失败自动回退外部浏览器并经 rail toast 提示；新增 `uiStatus` / `resetLoginState` 通道，设置页「重置登录状态」在壳 UI 下同时清理壳内登录 partition
- 壳入口平台选择器：壳 UI 启动先选平台（抖店 / 巨量百应 / 抖音团购，官方品牌图标），选择即自动在壳内打开对应直播控制台并连接；记住上次选择——下次启动跳过选择器直接恢复；中控台面板新增「切换平台」；eos（抖音团购）纳入壳内直连；平台/对象目录由主进程单一真源下发
- 壳内页面缩放：`Cmd/Ctrl + =` 放大、`Cmd/Ctrl + -` 缩小、`Cmd/Ctrl + 0` 重置（50%–200%），按站点自动记忆（官方中控台 100% 时窗口裁切问题）；壳模式新增自定义应用菜单承载缩放（默认菜单 Zoom 角色对 WebContentsView 无效）

### 🐞 Bug Fixes

- 修复壳内 attach 登录时弹窗回退返回原页面后仍被关闭，导致登录等待 `waitForSelector` 抛 `Target closed`——抖音小店/巨量百应登录及百应中控台跳转改为 `newPage !== 原 page` 才关闭旧页（launched 模式弹窗语义不变）
- 修复 CDP 调试端口在异步加载下不生效：`remote-debugging-port` 开关上移至主入口同步注入，默认随机端口（打包/开发一致，规避固定 9222 多实例冲突），attach 侧经 `DevToolsActivePort` 文件发现实际端口，`LM_CDP_PORT` 仍可显式固定供 harness 复用
- 修复 `cdpEndpoint` 把端口文件第 2 行 `/devtools/browser/<id>` 拼进 wsEndpoint 导致 `connectOverCDP` 请求未知路径而 connect-failed——现仅返回 `http://127.0.0.1:{port}` 基址，第 2 行只作形状校验
- 修复壳内官方页触发外部协议深链（如 `bytedance://dispatch_message/`）导致 macOS 弹「未设定用来打开 URL 的应用程序」：新增页面导航守卫，仅放行 `http(s)/about/data/blob`，其余协议拦截并记日志（pageView / 壳窗口 / 入口视图三类载体统一挂载）
- 修复壳内 attach 时官方页跨域登录弹窗被判为外链、逃逸到系统浏览器（如百应 `douyinec.com ↔ buyin.jinritemai.com`）：平台层声明可信域名 `ownedOrigins` 并随会话注入，跨域但受信的登录/中控弹窗改为 fold 折入壳内

### ⚠️ 契约变更（开源 fork 注意）

- 壳通道 `shell:leaveWarn` 重命名为 `shell:warnToast`（语义泛化为通用「主进程 → rail」告警）：外部插件/脚本如有监听旧通道名需同步改名；旧名残留已由契约扫描测试保证为 0
- 新增壳通道 `shell:entryCatalog` / `entrySelect` / `entryIntent` / `entrySkip` / `entryReopen` / `railReady`（shell 命名空间 17→23 键，契约测试同步）；classic 模式不触达、主进程 handler 内 no-op

## v1.6.4

### 🚀 Features

- 全应用 UI 重构（现代轻量风）+ 工程基建 ([739fc85](https://github.com/yklg/Live-Mod/commit/739fc85))
- 更新源改为 package.json.repository 可配置，未配置时禁用更新检查 ([d34b346](https://github.com/yklg/Live-Mod/commit/d34b346))
- 重设计应用图标为「闪电直播窗」并生成三件套（svg/png/ico） ([bf817d2](https://github.com/yklg/Live-Mod/commit/bf817d2))
- 项目更名为 Live Mod（appId/标题/侧栏/README/LICENSE/CI 同步更新） ([ce3003f](https://github.com/yklg/Live-Mod/commit/ce3003f))

### 🐞 Bug Fixes

- 图标四角白底问题——改用纯 Node SDF 软件光栅化，零外部渲染依赖 ([a4c2d14](https://github.com/yklg/Live-Mod/commit/a4c2d14))
- 侧栏品牌图标打包后不显示——绝对路径改为相对路径 ([f951a60](https://github.com/yklg/Live-Mod/commit/f951a60))

## v1.6.3

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.6.1...v1.6.3)

### 🐞 Bug Fixes

- **抖音小店:** 修复抖音小店中控台无法连接的问题 #320 ([#320](https://github.com/qiutongxue/oba-live-tool/issues/320))
- **抖音小店:** 修复抖店连接后功能无法正常使用的问题，#322 ([#322](https://github.com/qiutongxue/oba-live-tool/issues/322))

## v1.6.2

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.6.1...v1.6.2)

### 🐞 Bug Fixes

- **抖音小店:** 修复抖音小店中控台无法连接的问题 #320 ([#320](https://github.com/qiutongxue/oba-live-tool/issues/320))

## v1.6.1

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.6.0...v1.6.1)

### 🚀 Features

- 模型列表更新 DeepSeek-V4，（deepseek-chat 和 deepseek-reasoner 即将弃用）
- 将 AI 提供商的模型列表更新转移到线上 ([5e5ecf1](https://github.com/qiutongxue/oba-live-tool/commit/5e5ecf1))

## v1.6.0

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.24...v1.6.0)

### 🚀 Features

- **自动发言:** 增加解除字数限制的开关 ([#301](https://github.com/qiutongxue/oba-live-tool/pull/301))
- **自动弹窗:** 新增自动弹窗的单品循环功能（感谢 [@zuowangyan](https://github.com/zuowangyan)）
- **抖店/百应:** 增加发红包功能（感谢 [@zuowangyan](https://github.com/zuowangyan)）

## v1.5.24

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.23...v1.5.24)

### 🚀 Features

- 添加快手小店的自动回复功能 ([a0bfcca](https://github.com/qiutongxue/oba-live-tool/commit/a0bfcca))

## v1.5.23

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.22...v1.5.23)

### 🚀 Features

- 分离AI对话和自动回复的AI配置 ([2ec6cc2](https://github.com/qiutongxue/oba-live-tool/commit/2ec6cc2))
- 添加无效数据的清理功能 ([6f0e90b](https://github.com/qiutongxue/oba-live-tool/commit/6f0e90b))

### 🐞 Bug Fixes

- 修复在自动发言页面切换账号时对应的评论内容无法更新的问题 ([ad67174](https://github.com/qiutongxue/oba-live-tool/commit/ad67174))
- **小红书:** 修复小红书无法发送评论的问题 #283 ([#283](https://github.com/qiutongxue/oba-live-tool/issues/283))

## v1.5.22

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.21...v1.5.22)

### 🐞 Bug Fixes

- 修复设置页面外部链接无法打开的问题 ([0a176c7](https://github.com/qiutongxue/oba-live-tool/commit/0a176c7))

## v1.5.21

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.20...v1.5.21)

### 🚀 Features

- **淘宝:** 新增自动回复功能（仅简单的评论回复） ([450dba1](https://github.com/qiutongxue/oba-live-tool/commit/450dba1))

### 🐞 Bug Fixes

- 修正自动弹窗任务中注册快捷键的拼写错误 ([6e48bae](https://github.com/qiutongxue/oba-live-tool/commit/6e48bae))
- 修复目录不存在时截屏报错的问题 ([68abdb2](https://github.com/qiutongxue/oba-live-tool/commit/68abdb2))
- **淘宝:** 修复淘宝（企业店铺）自动弹窗时找不到商品ID的问题 ([ac10b8b](https://github.com/qiutongxue/oba-live-tool/commit/ac10b8b))
- 修复淘宝评论监听的昵称显示问题 ([2b6550a](https://github.com/qiutongxue/oba-live-tool/commit/2b6550a))

## v1.5.20

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.19...v1.5.20)

### 🐞 Bug Fixes

- **淘宝**: 修复淘宝初次登录时无法连接中控台的问题 ([0059158](https://github.com/qiutongxue/oba-live-tool/commit/0059158))

## v1.5.19

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.18...v1.5.19)

### 🚀 Features

- 大大减轻了应用体积（减少了约 100MB）！

### 🐞 Bug Fixes

- 修改日志的错误堆栈显示信息 ([e3aee11](https://github.com/qiutongxue/oba-live-tool/commit/e3aee11))
- **淘宝:** 修复淘宝直播找不到评论框的问题 ([5fb39c1](https://github.com/qiutongxue/oba-live-tool/commit/5fb39c1))
- **淘宝:** 修复淘宝无法获取用户名的问题 ([1ddf73e](https://github.com/qiutongxue/oba-live-tool/commit/1ddf73e))

## v1.5.18

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.17...v1.5.18)

### 🚀 Features

- **小红书:** 小红书千帆/蒲公英新增自动回复功能 ([3c0bcbc](https://github.com/qiutongxue/oba-live-tool/commit/3c0bcbc))

### 🐞 Bug Fixes

- **抖音小店:** 修改判断登录成功的方式 ([8a904c4](https://github.com/qiutongxue/oba-live-tool/commit/8a904c4))
- **ui**: 修复点击新版本弹窗通知里的外部链接无法在应用外打开的问题 ([a0fa1f8](https://github.com/qiutongxue/oba-live-tool/commit/a0fa1f8))
- 修复 MacOS 的更新问题，减小 MacOS 应用体积 ([#246](https://github.com/qiutongxue/oba-live-tool/pull/246))

## v1.5.17

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.16...v1.5.17)

### 🚀 Features

- **视频号:** 新增自动回复功能 ([954c4ec](https://github.com/qiutongxue/oba-live-tool/commit/954c4ec))
- **视频号:** 新增评论上墙功能 ([44b3a4a](https://github.com/qiutongxue/oba-live-tool/commit/44b3a4a))

### 🐞 Bug Fixes

- 修复因网络原因无法提示手动下载更新的问题 ([fa7f603](https://github.com/qiutongxue/oba-live-tool/commit/fa7f603))
- 修复部分类型错误 ([0cc922d](https://github.com/qiutongxue/oba-live-tool/commit/0cc922d))
- 修复在特定情况下某些不支持的平台能访问到自动回复页面的问题 ([f56213a](https://github.com/qiutongxue/oba-live-tool/commit/f56213a))
- **视频号:** 修复浏览器窗口过窄时视频号仍无法连接中控台的问题 ([977d194](https://github.com/qiutongxue/oba-live-tool/commit/977d194))

## v1.5.16

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.15...v1.5.16)

### 🚀 Features

- 使用日志记录 WebSocket 的错误 ([42ce04d](https://github.com/qiutongxue/oba-live-tool/commit/42ce04d))
- 在应用启动时使用日志记录相关应用信息 ([e18b83d](https://github.com/qiutongxue/oba-live-tool/commit/e18b83d))
- 优化软件更新逻辑及软件更新 UI 界面 ([02660a6](https://github.com/qiutongxue/oba-live-tool/commit/02660a6))
- 添加主进程未捕获异常和未处理拒绝的处理逻辑 ([0ef990a](https://github.com/qiutongxue/oba-live-tool/commit/0ef990a))

### 🐞 Bug Fixes

- **巨量百应:** 修复巨量百应中控台页面样式错误的问题 ([053cd53](https://github.com/qiutongxue/oba-live-tool/commit/053cd53))
- 修复评论监听和WebSocket无法正常关闭的问题 #231 ([#231](https://github.com/qiutongxue/oba-live-tool/issues/231))
- 改进错误日志记录以包含堆栈信息 ([c1ba0d3](https://github.com/qiutongxue/oba-live-tool/commit/c1ba0d3))
- 优化未捕获异常的错误处理和提示信息 ([c7d5472](https://github.com/qiutongxue/oba-live-tool/commit/c7d5472))
- 修复因意外错误导致无法正常停止任务的问题 ([d7aa0d9](https://github.com/qiutongxue/oba-live-tool/commit/d7aa0d9))
- 修复自动弹窗任务在手动停止或更新配置时无法及时中止的问题 ([dd32837](https://github.com/qiutongxue/oba-live-tool/commit/dd32837))

## v1.5.15

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.14...v1.5.15)

### 🚀 Features

- **ui:** 中控台平台选项持久化 ([80ae047](https://github.com/qiutongxue/oba-live-tool/commit/80ae047))
- **中控台:** 优化中控台的连接逻辑，加快连接速度，减少连接错误 ([18f83f5](https://github.com/qiutongxue/oba-live-tool/commit/18f83f5))

### 🐞 Bug Fixes

- **视频号:** 修复浏览器窗口过窄时无法获取用户名的问题 #226 ([#226](https://github.com/qiutongxue/oba-live-tool/issues/226))
- **ui:** 修复更新提示对话框无法通过右上角的 x 关闭的问题 ([d3ba6bb](https://github.com/qiutongxue/oba-live-tool/commit/d3ba6bb))
- **小红书:** 修复因浏览器视口调整导致小红书获取用户名失败的问题 #225 ([#225](https://github.com/qiutongxue/oba-live-tool/issues/225))

## v1.5.14

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.13...v1.5.14)

### 🐞 Bug Fixes

- **视频号:** 修复视频号重复弹窗失败的问题 #219 ([#219](https://github.com/qiutongxue/oba-live-tool/issues/219))
- 修复浏览器视口固定的问题 #219 ([#219](https://github.com/qiutongxue/oba-live-tool/issues/219))
- **小红书千帆&蒲公英:** 修复小红书千帆&蒲公英弹卡可能会失效的问题 #216 ([#216](https://github.com/qiutongxue/oba-live-tool/issues/216))

## v1.5.13

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.12...v1.5.13)

### 🚀 Features

- 新增在窗口标题中显示应用版本号 ([5aefaab](https://github.com/qiutongxue/oba-live-tool/commit/5aefaab))

### 🐞 Bug Fixes

- **千帆**: 修复小红书千帆登录无法获取用户名的问题 ([d086418](https://github.com/qiutongxue/oba-live-tool/commit/d086418))
- **抖音小店&巨量百应**: 修复找不到弹窗按钮的问题 ([48acc28](https://github.com/qiutongxue/oba-live-tool/commit/48acc28))

## v1.5.12

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.11...v1.5.12)

### 🚀 Features

- 新增小红书蒲公英平台 ([0e7bf11](https://github.com/qiutongxue/oba-live-tool/commit/0e7bf11))

### 🐞 Bug Fixes

- **小红书千帆:** 修复小红书千帆自动弹窗无效的问题 ([3ce60c5](https://github.com/qiutongxue/oba-live-tool/commit/3ce60c5))
- 修复部分类型错误以及遗留问题 ([c000776](https://github.com/qiutongxue/oba-live-tool/commit/c000776))
- 修复ipc传参缺失 accountId 的问题 ([3e7135c](https://github.com/qiutongxue/oba-live-tool/commit/3e7135c))
- 修复更新配置时计时器未重置的问题 ([12150cb](https://github.com/qiutongxue/oba-live-tool/commit/12150cb))
- 进一步补充连接中控台的功能 ([bc8f622](https://github.com/qiutongxue/oba-live-tool/commit/bc8f622))
- 优化一键发送时的日志提示内容 ([081cf3d](https://github.com/qiutongxue/oba-live-tool/commit/081cf3d))
- 修复定时任务的部分错误 ([a214d0d](https://github.com/qiutongxue/oba-live-tool/commit/a214d0d))
- 修复中控台连接中断时的部分错误 ([ae3b7d0](https://github.com/qiutongxue/oba-live-tool/commit/ae3b7d0))
- 修复无头模式登录报错的问题 ([89396de](https://github.com/qiutongxue/oba-live-tool/commit/89396de))

## v1.5.11

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.10...v1.5.11)

### 🐞 Bug Fixes

- **中控台:** 修复抖音小店&小红书打开新页面可能造成的问题 ([dc00ebb](https://github.com/qiutongxue/oba-live-tool/commit/dc00ebb))
- **中控台:** 修复巨量百应登录页面样式错误的问题 ([f184e34](https://github.com/qiutongxue/oba-live-tool/commit/f184e34))

## v1.5.10

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.9...v1.5.10)

### 🚀 Features

- **自动发言:** 优化自动发言的消息编辑界面 ([6424ef0](https://github.com/qiutongxue/oba-live-tool/commit/6424ef0))
- **自动回复:** 添加关键字回复的批量编辑功能 ([7a27d9c](https://github.com/qiutongxue/oba-live-tool/commit/7a27d9c))
- **自动发言&自动回复:** 支持在文本中使用形如 {选项A/选项B/选项C} 的变量 ([499d973](https://github.com/qiutongxue/oba-live-tool/commit/499d973))
- **中控台:** 添加无头模式开关 ([94587c3](https://github.com/qiutongxue/oba-live-tool/commit/94587c3))

### 🐞 Bug Fixes

- 修复抖音小店登录页面样式混乱的问题, fix #158 ([#158](https://github.com/qiutongxue/oba-live-tool/issues/158))

## v1.5.9

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.8...v1.5.9)

### 🐞 Bug Fixes

- 修复登录控制台成功以后页面状态更新问题, fix #154 ([#154](https://github.com/qiutongxue/oba-live-tool/issues/154))

## v1.5.8

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.7...v1.5.8)

### 🚀 Features

- 新增对淘宝直播平台的支持 ([30a7623](https://github.com/qiutongxue/oba-live-tool/commit/30a7623))
- **ui:** 添加连接到淘宝中控台时的提示 ([9ad7645](https://github.com/qiutongxue/oba-live-tool/commit/9ad7645))
- **中控台:** 连接中控台失败时自动关闭浏览器 ([996181f](https://github.com/qiutongxue/oba-live-tool/commit/996181f))

### 🐞 Bug Fixes

- **中控台:** 修复未直播状态下登录淘宝平台后错误提示异常问题 ([8f89ed2](https://github.com/qiutongxue/oba-live-tool/commit/8f89ed2))
- **中控台:** 优化登录逻辑，只要登录成功就保存登录状态 ([f888042](https://github.com/qiutongxue/oba-live-tool/commit/f888042))
- 修复账号管理的部分问题 ([887fa19](https://github.com/qiutongxue/oba-live-tool/commit/887fa19))
- 优化删除账号的逻辑 ([991a77f](https://github.com/qiutongxue/oba-live-tool/commit/991a77f))
- **ui:** 修复在中控台连接中切换到其它页面后连接状态失效的问题 ([75a254e](https://github.com/qiutongxue/oba-live-tool/commit/75a254e))
- 修复中控台连接失败后自动断开连接有延时的问题 ([01813fc](https://github.com/qiutongxue/oba-live-tool/commit/01813fc))

## v1.5.7

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.6...v1.5.7)

### 🚀 Features

- **ui:** API Key 输入栏添加隐藏/显示功能 ([66269aa](https://github.com/qiutongxue/oba-live-tool/commit/66269aa))

### 🐞 Bug Fixes

- **ui:** 修复火山引擎配置中可能会造成歧义的信息 ([10f65f3](https://github.com/qiutongxue/oba-live-tool/commit/10f65f3))
- **ai:** 修复 API Key 测试连接的部分问题 ([47a147a](https://github.com/qiutongxue/oba-live-tool/commit/47a147a))
- **中控台:** 修复视频号无法登录的问题 fix #149 ([#149](https://github.com/qiutongxue/oba-live-tool/issues/149))

## v1.5.6

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.5...v1.5.6)

### 🚀 Features

- **自动回复:** 添加 WebSocket 服务支持 ([46509f0](https://github.com/qiutongxue/oba-live-tool/commit/46509f0))

### 🐞 Bug Fixes

- **自动发言:** 修复小红书平台无法正常发送评论的问题 ([6bb4b71](https://github.com/qiutongxue/oba-live-tool/commit/6bb4b71))
- **中控台:** 增加小红书连接中控台的容错 ([932640f](https://github.com/qiutongxue/oba-live-tool/commit/932640f))
- **中控台:** 优化连接中控台时的提示内容 ([e5f226f](https://github.com/qiutongxue/oba-live-tool/commit/e5f226f))

## v1.5.5

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.4...v1.5.5)

### 🚀 Features

- **自动回复:** 添加了过滤器，可以设置满足过滤器条件时的回复信息 ([#130](https://github.com/qiutongxue/oba-live-tool/pull/130))

### 🐞 Bug Fixes

- **自动回复:** 修复了自动回复的设置在不同账号间切换导致的异常问题

## v1.5.4

[compare changes](https://github.com/qiutongxue/oba-live-tool/compare/v1.5.3...v1.5.4)

### 🚀 Features

- 新增快手小店登录 ([fb7d842](https://github.com/qiutongxue/oba-live-tool/commit/fb7d842))
- 新增快手小店的自动弹窗和自动发言 ([4bed9d7](https://github.com/qiutongxue/oba-live-tool/commit/4bed9d7))
- **自动回复:** 添加新设置-当订单已支付时才自动回复, fix #118 ([#118](https://github.com/qiutongxue/oba-live-tool/issues/118))
- **更新器:** 显示新版本的更新内容 #31 ([#31](https://github.com/qiutongxue/oba-live-tool/issues/31))

### 🐞 Bug Fixes

- 修复部分错误无法被正确捕捉的问题 ([c08c1e0](https://github.com/qiutongxue/oba-live-tool/commit/c08c1e0))
- **自动发言:** 降低随机空格中空格出现的概率，随机发送时不和上一条重复, fix #120 ([#120](https://github.com/qiutongxue/oba-live-tool/issues/120))
