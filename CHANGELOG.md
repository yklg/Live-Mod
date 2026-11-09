# Changelog

## Unreleased

### 🐞 Bug Fixes

- 修复 macOS 发布包打开提示「已损坏，无法打开」：electron-builder 在没有 Apple Developer 证书时会跳过签名，产物只有 Electron 自带的 linker-signed（bundle 未绑定、无 `_CodeSignature/CodeResources`），macOS 15 的 Gatekeeper / LaunchServices 直接拒绝——即使 `xattr -cr` 清掉 quarantine，LaunchServices 启动仍会在 0.1s 内静默退出（v1.8.0 实测）。现新增 `scripts/afterPackSignMac.mjs`，打包后对 `.app` 做 **ad-hoc 签名**（配置 Developer ID 证书时，后续正式签名会覆盖本次签名），`codesign --verify --deep --strict` 通过、清掉隔离标记后双击可正常启动；README 补充 macOS 下载安装与首次打开说明
- 修复 Unit Tests CI 红：`trustCoverage.test.ts` 顶层 import `#/utils/ipc` 会连带 import electron，而 CI 的 Unit Tests workflow 设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（不下载二进制）→ `Electron failed to install correctly`。现补 `vi.mock('electron')`（该测试只做源码扫描与静态声明表读取，不需要真实 `ipcMain`）

## v1.8.0

### 🚀 Features

- 壳内弹窗改为浏览器语义：官方中控台页面 `window.open`/`target=_blank` 不再折叠替换当前页，统一由壳内**新 Tab** 承载（复用 opener 的账号 partition 保持登录态）；**opener 为当前 Tab 时新 Tab 自动前台并接管键盘焦点**，后台页自发弹窗保持后台不抢焦点（`popupAction` 门控）；后台 Tab **延迟挂载**避免隐藏 view 清空键盘焦点；登录/进中控台等自动化窗口期由会话层显式声明同页折叠意图（`popupIntent`），登录完成即复位
- 自动化页面保活不变量（E2E 固化 `poc/shell/e2e-tab-liveness.mjs`）：会话页在**非激活 / 窗口最小化 / 长驻**下定时器不被冻结、Playwright click/fill/dispatch/scroll 仍可用——自动讲解在用户切走页面后继续生效；焦点契约（`TabView.focus`）仅前台激活/显式切 Tab 触发，close/migrate 不抢焦点
- 评论监听健壮性：修复 `ControlListener.keepPageRunning` 死代码（`isRunning` 从未置 true，保活从未执行；修复后**只点「新评论」按钮**，不再通用点击 auxo 弹窗主按钮——避免误触真实配置弹窗、也不抢走下播判定专用的「直播总结」信号）；新增评论通道存活探针（连续 30s 无非空 `comment/info` 数据 → 日志 + toast 提示，不静默、不停止监听，60s 冷却；解析失败告警同样 60s 冷却防刷屏）；`CompassListener` 在壳内 attach 模式改用新的 `BrowserSession.createAuxPage`（隐藏窗口 + nonce 寻址），不再依赖 attach 下不可用的 `context.newPage()`，且失败路径回收 aux 载体并抛出原错误（不再静默丢弃 Promise）
- 会话页身份观测：`AccountSession` 监听主 frame 导航，离开中控台且任务运行中时提示「中控台页面已离开，任务可能失效」（每段离开一次，回中控页复位）；平台层新增 `IPlatform.isControlPageUrl` 契约（域名知识仍在平台层），身份判据按**已知中控台路由白名单**匹配（`/ffa/content-tool/live/control`、`/ffa/buyin/dashboard/live/control`、`/dashboard/live/control`、`/livesite/live/current`），同站业务页/菜单漂移不再被误判为「仍在中控台」
- 业务面板一键隐藏：`Cmd/Ctrl + \` 在任意视图聚焦时切换右栏业务面板开合（官方中控台页面聚焦同样生效），面板头部同步显示 `⌘\` 提示——右栏是 600px overlay，官方页面右侧被遮挡时不再只能靠点 rail 图标
- B2 真实 Chrome 评论后端（壳内「直播互动」面板的读 / 写链路）：用独立 **headless 真实 Chrome** 打开抖店中控台，**被动监听**官方页面自己发出的 `comment/info` 响应（不发请求、不依赖 Electron 指纹），读取实时评论；发送回复同样经该真实 Chrome 页面完成，并与自动回复任务闭环接线。面板支持发送评论、多账号归属与连接状态显示
- 壳内评论监听自动启动：壳 UI 连接后自动启动评论监听（B2 后端已随 `connect()` 启动），不再需要手动点「开始监听」；经典模式保留手动语义（平台原生监听器启动成本高，用户知情）
- 调试注入通道（主进程仅 `LM_SHELL_DEBUG=1` 时注册 `tasks:commentBackend:debugInject`，生产不存在该通道），面板提供「注入测试评论」按钮：不连直播即可验证面板的显示 / 切页回放 / 快照合并链路
- 工程：新增 `scripts/start-dev.sh` 一键启动壳模式 dev（自动解除 `ELECTRON_RUN_AS_NODE` 注入、解除 Vite 批量删除守卫、显式绑定 `127.0.0.1`，Ctrl+C 退出）

### 🐞 Bug Fixes

- 修复自动讲解对「正在讲解」商品的无停顿来回切换：商品已处于讲解中（按钮显示「取消讲解」）时，此前仍会先点一次「取消讲解」再点「讲解」，把正在进行的讲解取消后立刻重启——运营侧看到状态来回切换，且页面按钮态未稳定时第二次点击可能丢失。现将 `toggleButton` 改为**「确保按钮处于目标状态」**语义：已在讲解中直接视为本轮就绪、**零点击**，下一轮由任务队列推进到下一个商品；仅当按钮处于「讲解」源态时才点击（点击后 1s 复查、最多重试 5 次，文案漂移/禁用态照旧报错）。抖音小店/巨量百应/抖音团购（经 `toggleButton`）与快手（平台独立实现）同此语义；并补充 `toggleButton` 契约单测（已在讲解零点击/点击后不足再点/文案漂移/禁用态/尝试上限）
- 修复壳内「直播互动」面板切走/关闭后评论列表清空：评论事实此前只存在渲染层组件内存（`LiveInteraction` 的 `useState`），主进程 `getState` 只返回状态无历史。现新增主进程 `CommentStore`（写读端口分离、每账号 200 条 / 全局 500 条环形缓冲、淘汰打 stderr），`getState` 返回每账号最近 100 条，面板重挂载/切页后可回放；关闭账号时同步清理历史
- 修复评论 IPC 在 dev 下必然被拒：`ipc/commentBackend.ts` 的来源判据是 `url.includes('/dist/rail.html')`，而 dev URL 不含 `/dist/`。现改为**通道级声明表 + 统一前置校验**（`CHANNEL_TRUST`），判据按视图身份（rail/chrome/entry/notice/classic），dev 与打包一致；新增源码扫描测试防止新增受限通道漏声明
- 修复 IPC 无来源授权机制：`typedIpcMainHandle` 此前仅做类型包装，新增 handler 默认无来源约束。现在受限通道必须在 `CHANNEL_TRUST` 声明，未声明的通道行为完全不变（52 处注册里 50 处零回归）
- 修复多账号下可读写任意 `accountId` 评论的越权：`getState` 只暴露仍登记在案会话的数据，`send` 对未知账号返回 `{ ok:false }`
- 修复业务事件静默进黑洞：`windowManager.sendTo` 在 `ui` 目标缺失时会隐式回退到主窗口 webContents，而壳模式下主窗口是不加载内容的纯容器（事件丢失且无任何报错）。现已**删除隐式回退**，改为显式登记目标 + 待发队列（关键事件白名单 18 个通道：10 条显式 + `updater:` 前缀，队列容量 32 / TTL 30s）+ 首次失败打 stderr（不走 logger，避免 logger 经 send 推送造成递归）；经典模式改为显式 `setUITarget`
- 修复 B2 评论读链路静默失效：`page.on('response')` 不命中时无任何信号，面板永远 0 条且无原因。现以「comment/info 响应是否还来」为基线（合法空列表算健康），超过 30s 无响应标记 `degraded` 并在面板显示「可能失效」与最近一次响应时间；收到数据即自动回 `live`
- 修复面板评论合并的跨账号误删：去重键由裸 `id` 改为 `(accountId, id)`（官方 `comment_id` 只在单场直播内唯一，多账号可能撞车），排序与主进程 store 共用同一比较器
- 修复 `getState` 失败被静默吞掉（`.catch(() => {})`）：面板现在显示「读取历史失败：<原因>」，dev 下门禁问题不再表现为「永远未连接」且无线索
- 修复壳内点击中控台功能导致「当前页被替换 → 误判直播已结束 → 直接断开并销毁会话/Tab」：`liveStatusWatcher` 新增页面身份观测（`isObservingPage`/`onUnobservable`）——页面已离开中控台时**不计数、不判下播**，恢复可观测后原 armed 语义不变；同时新增弹窗兜底导航抑制（官方页 `if(!w) location.href` 兜底不再劫持当前页）
- 修复误判下播的破坏性后果：`handleLiveEnded` 拆分为「停止全部任务 + 通知」，**不再自动断开/销毁会话与 Tab**（断开由用户显式操作；实测「直播总结」误判时不再丢中控台页面）
- 修复 `WebContentsView` 上页面 `window.close()` 无守卫的隐患：明确弹窗策略不再依赖 `allow`（allow 产生不可管理的原生窗口），自复制弹窗保持 deny
- 修复 `LM_CDP_PORT=0` 被判非法端口导致 attach 静默降级外部浏览器：`'0'` 按「随机端口」处理（走 `DevToolsActivePort` 发现链）
- 修复 B2 采集进程静默死亡后永久空白：`headless Chrome` 被系统杀掉时（实测启动 3.9 小时后进程消失、日志无 stop 记录、面板永远 0 条）此前无任何信号。现以 `Browser.isConnected()` 为存活探针（`BackendPageHandle.isConnected`，**统一经 `toPageHandle` 构造**，手写句柄会漏字段导致探针恒真），5s 周期探测、与「无数据」严格区分；`registry.ensure` 发现实例已死则丢弃重建，会话层收到退出后 2s 自动重启（60s 内最多 3 次防风暴）
- 修复 B2 依赖装配漏接存活探针：`AccountSession` 的 `createSession` 此前手写 `{ page, close }` 绕过了唯一适配点，使 `isConnected` 恒为 `true`、死亡检测完全失效。现改为复用 `toPageHandle`，并新增源码扫描测试（`depsAssembly.test.ts`）守卫「句柄只允许一处构造」
- 修复评论监听失败静默：抖音小店 `startCommentListener` 丢弃 Promise（罗盘监听失败无任何报错、UI 仍显示监听中）——改为与会话层同构的返回 Promise，失败可被任务层捕获

## v1.7.0

### 🚀 Features

- 光圈式壳界面：新增 chrome（顶栏）/ rail（右栏）双入口，壳内 Tab 统一管理（新建/关闭/切换/前进后退/刷新），右栏功能面板开合与「离开中控页」任务护栏，几何与面板状态由主进程单一真源裁决
- 壳内登录默认化：壳 UI 形态下抖音小店/巨量百应连接默认在壳内 Tab 完成登录（attach），无需逐账号实验开关；新增「强制外部浏览器（调试用）」逃生口（与经典模式「壳模式」开关形态隔离互不生效）；attach 失败自动回退外部浏览器并经 rail toast 提示；新增 `uiStatus` / `resetLoginState` 通道，设置页「重置登录状态」在壳 UI 下同时清理壳内登录 partition
- 壳入口平台选择器：壳 UI 启动先选平台（抖店 / 巨量百应 / 抖音团购，官方品牌图标），选择即自动在壳内打开对应直播控制台并连接；记住上次选择——下次启动跳过选择器直接恢复；中控台面板新增「切换平台」；eos（抖音团购）纳入壳内直连；平台/对象目录由主进程单一真源下发
- 壳内页面缩放：`Cmd/Ctrl + =` 放大、`Cmd/Ctrl + -` 缩小、`Cmd/Ctrl + 0` 重置（50%–200%），按站点自动记忆（官方中控台 100% 时窗口裁切问题）；壳模式新增自定义应用菜单承载缩放（默认菜单 Zoom 角色对 WebContentsView 无效）
- 壳面板密度优化：面板宽度 800→600（overlay 遮挡 −200px：1280 窗页面可见 480→680、1024 最小窗 224→424；降级分支随最小窗 1024 文档化为不可达）；面板树引入容器查询密度适配层（`@container/panel`）——面板内页头/卡片/输入/弹窗/设置导航自动紧凑（页头 20→16px、卡片留白 24→16px），经典模式结构性零变化；「使用说明」「高级设置」在面板内折叠为默认收起行（`aria-expanded`），「切换平台」改为图标按钮（tooltip）；自动弹窗/自动发言在 600 面板内回退单列紧凑布局（两列内容宽度不足）；面板内页头标题与操作区上下分层，避免 600 宽标题被挤压
- 壳级通知覆盖层：壳内全部 toast 统一收敛到页面右上通知 HUD（独立透明子窗口、窗口级点击穿透、父子窗口置顶、跟随主窗口移动/缩放），支持成功/错误/警告/信息四变体、最多 3 条、按变体自动消失（错误 6s/警告 5s/其余 4s）、常驻 `aria-live` 可访问性；经典模式 Toaster 行为不变
- 入口选择器 UI 优化：去除「壳内直连」绿色徽标（信息去重到副标题）、卡片图标/留白/悬停优化、「进入 →」右对齐、「记住选择」行开关右对齐、暂不进入弱化为文本按钮
- 工程：新增 `Unit Tests` CI workflow（PR + main 跑 vitest）；新增 `pnpm test:e2e:shell` 壳层 E2E 一键脚本；旧「面板连接」E2E 入库

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
