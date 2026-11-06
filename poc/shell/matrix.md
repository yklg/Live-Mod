# 平台 × 环境兼容矩阵（PoC-0 · 自动评估输出）

> 生成时间：2026/11/5 19:50:11（harness: poc/shell/evaluate.mjs）
> 证据目录：poc/shell/evidence/

| 项              | 验证内容                                                 | 结果 | 详情                                                                                                                                                     |
| --------------- | -------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| g-fuse          | CDP 端口可达（fuse 未禁用）                              | ✅   | Chrome/136.0.7103.115                                                                                                                                    |
| a               | attach 后寻址壳窗口 target                               | ✅   | https://fxg.jinritemai.com/login/common?extra=%7B%22target_url%22%3A%22https%3A%2F%2Ffxg.jinritemai.com%2Fffa%2Fbuyin%2Fdashboard%2Flive%2Fcontrol%22%7D |
| a-load          | 壳窗口页面加载                                           | ✅   | title="抖店登录-抖店后台-抖音电商后台"                                                                                                                   |
| d               | 多 target 寻址（主窗口+壳）                              | ✅   | file:///Users/yilukaige/LIve%20Mod/Live%20Mod/dist/index.htm \| https://fxg.jinritemai.com/login/common?extra=%7B%22target_u \| about:blank#lm-poc-aux   |
| b-click         | CDP 可信点击（isTrusted=true 且元素响应）                | ✅   | [true,true]                                                                                                                                              |
| b-type          | CDP 逐键输入生效                                         | ✅   | value="123"                                                                                                                                              |
| c-ua            | UA 已剥离 Electron/LiveMod 标识                          | ✅   | ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.115 Safari/537.36"                          |
| c-init          | attach 下 context.addInitScript 生效（stealth 回退通道） | ✅   | reload 后标记存在                                                                                                                                        |
| c-webdriver-fix | addInitScript 掩蔽 navigator.webdriver 生效              | ✅   | webdriver=undefined（原始值 false）                                                                                                                      |
| e-newpage-limit | newPage 平台限制记录（预期不支持）                       | ✅   | browserContext.newPage: Protocol error (Target.createTarget): Not supported                                                                              |
| e-auxpage       | Electron 侧隐藏辅助页替代路径可用（多账号/监听页前提）   | ✅   | 隐藏 BrowserWindow 可 attach 并 evaluate 驱动                                                                                                            |
| f-close         | attached close 仅断连不杀宿主                            | ✅   | close 后 CDP 仍响应：Chrome/136.0.7103.115                                                                                                               |
| f-reconnect     | 重复 attach 可用                                         | ✅   | 二次连接并寻址成功                                                                                                                                       |

## 安全约束（C2）

- 9222 调试端口当前对生产开放（app.ts:73），正式化必须门控或改 pipe 传输。

## 待人工项（PoC-1）

- 扫码登录 + 风控双判（CreepJS 基线截图 vs 真实 Chrome）
- 弹窗流（window.open → 子 view）
- 下播信号（真实开播→下播，ILiveStatusWatcher 壳化后仍触发）


## PoC-1 自动部分（2026/11/5 20:03:30）

| 项        | 验证内容                   | 结果 | 详情                                                                                                                  |
| --------- | -------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| 1-entry   | 壳窗口存在（登录后）       | ✅   | https://fxg.jinritemai.com/ffa/content-tool/live/control                                                              |
| 1-control | 中控台页面正常加载         | ✅   | title="直播中控台" bodyText=1613字符 url=https://fxg.jinritemai.com/ffa/content-tool/live/control                     |
| 1-creep   | CreepJS 基线采集           | ✅   | {"headless":"3","wd":"false","ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like "} |
| 1-risknav | 全程无风控/验证页跳转      | ✅   | 共 4 次导航，无 verify/captcha 命中                                                                                   |
| 1-session | 登录态保持（未掉回登录页） | ✅   | https://fxg.jinritemai.com/ffa/content-tool/live/control                                                              |

> 证据：poc/shell/evidence/poc1-*.png
> 待人工后续：心跳驻留 30min、开播→下播信号、弹窗流
