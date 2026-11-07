import { Result } from '@praha/byethrow'
import { Notification, session } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { teardownSession } from '#/driver/types'
import { TaskNotSupportedError } from '#/errors/AppError'
import { emitter } from '#/event/eventBus'
import { createLogger } from '#/logger'
import {
  type BrowserSession,
  browserManager,
  type StorageState,
} from '#/managers/BrowserSessionManager'
import { platformFactory } from '#/platforms'
import type { ExecMode } from '#/platforms/envMatrix'
import {
  type IPlatform,
  isCommentListener,
  isLiveStatusWatcher,
  isPerformComment,
  isPerformPopup,
  isPinComment,
  isSendRedPacket,
} from '#/platforms/IPlatform'
import { commentBackendRegistry } from '#/services/commentBackend/registry'
import { createAutoCommentTask } from '#/tasks/AutoCommentTask'
import { createAutoPopupTask } from '#/tasks/AutoPopupTask'
import { createCommentListenerTask } from '#/tasks/CommentListenerTask'
import type { ITask } from '#/tasks/ITask'
import { createPinCommentTask } from '#/tasks/PinCommentTask'
import { createSendBatchMessageTask } from '#/tasks/SendBatchMessageTask'
import windowManager from '#/windowManager'
import { accountTabPartition } from '#/windows/shellTabManager'

export class AccountSession {
  private platform: IPlatform
  private browserSession: BrowserSession | null = null
  private activeTasks: Map<LiveControlTask['type'], ITask> = new Map()
  // 直播结束处理重入守卫：connect 置 false，disconnect 置 true（会话关闭后不再响应结束信号）
  private liveEndedHandled = true

  // ===== 会话页身份观测（fix-shell-popup-navigation-liveend A2）=====
  // 为什么放在会话层：页面漂移（壳层 fold / 官方页兜底导航 / goBack）是「会话 Page 已不在中控台」
  // 的事实，而会话层同时持有 platform（控制页 URL 判定）与 activeTasks（决定是否值得打扰用户）。
  // 本层只观测+告警，不阻断、不恢复——弹窗语义归壳层，页面恢复归用户/壳层导航。
  /** 已绑定 framenavigated 的 Page（WeakSet 幂等：page 被替换后重新绑定不会重复监听） */
  private observedPages = new WeakSet<object>()
  /** 当前会话页是否已离开中控台（离开=true；回到控制页复位。A3 watcher 身份透传的会话侧状态） */
  private pageOffControl = false
  /** 本段「离开中控台」是否已告警（回到控制页复位 → 每段离开只提示一次，不刷屏） */
  private leaveControlWarned = false

  constructor(
    platformName: LiveControlPlatform,
    private account: Account,
    private logger = createLogger(`@${account.name}`),
  ) {
    this.platform = new platformFactory[platformName]()
  }

  async connect(config: { headless?: boolean; storageState?: string; mode?: ExecMode }) {
    this.liveEndedHandled = false
    // 重连 = 新会话页：页身份状态按会话重置（WeakSet 只增不重置，旧 Page 已随会话销毁）
    this.pageOffControl = false
    this.leaveControlWarned = false
    const mode: ExecMode = config.mode ?? 'launch'
    let storageState: StorageState
    if (config.storageState) {
      this.logger.info('检测到已保存登录状态')
      storageState = JSON.parse(config.storageState)
    }

    // attach 模式：壳窗口 + CDP attach 回 Electron 自身（R1'）；登录态活在 partition，不搬运 storageState
    this.browserSession =
      mode === 'attach'
        ? await browserManager.createAttachedSession(this.account.id, {
            popupOrigins: this.platform.ownedOrigins,
          })
        : await browserManager.createSession(config.headless, storageState)

    // 弹窗语义生命周期（fix-shell-popup-navigation-liveend Phase 2）：
    // attach 壳模式在建会话后立即声明「登录窗口期旧语义」——登录/进中控台链路依赖官方页
    // window.open 折叠当前页完成跳转（壳内新 Tab 会打断自动化链路）。认证完成必须复位为浏览器
    // 语义，否则用户后续点击中控台功能仍会被 fold 劫持当前页（症状②）。
    // launched/窗口承载模式无该方法，可选调用自动无感。
    this.browserSession.setPopupMode?.('navigate')
    this.observePageNavigation()
    try {
      await this.ensureAuthenticated(this.browserSession, config.headless, mode)
    } finally {
      // 登录窗口期结束（成功/异常都算结束）：恢复浏览器语义，防残留 fold 意图劫持用户后续点击。
      // ensureAuthenticated 内可能替换会话（无头登录换实例）；此时该方法不存在 → 无感。
      this.browserSession.setPopupMode?.(null)
    }
    // 认证链路可能替换会话页（平台 login 内 browserSession.page = newPage / 无头模式换会话）：
    // 页身份观测必须绑到最终会话页，否则观测的是已废弃的登录页。
    this.observePageNavigation()

    // launched 才保存 storageState（attach 的 Cookie 由 partition 持久化，PoC 二次免登已实证）
    if (this.browserSession.kind === 'launched') {
      const state = JSON.stringify(await this.browserSession.context.storageState())

      // 登录成功之后马上先保存一次登录状态，确保后续发生意外后不用重新登录
      windowManager.send(IPC_CHANNELS.chrome.saveState, this.account.id, state)
    }

    // 此时可以确保正在中控台页面，获取用户名
    // 获取用户名不应该和连接中控台的行为冲突
    this.platform
      .getAccountName(this.browserSession)
      .then(accountName => {
        windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
          ok: true,
          accountId: this.account.id,
          accountName,
        })
      })
      .catch(error => {
        this.logger.error('获取用户名失败：', error)
        windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
          ok: false,
        })
      })

    // 浏览器被外部主动关闭时，程序自动断开所有操作
    // 不用 browserContext close 或 browser disconnected 的原因：
    // Windows 手动关闭浏览器时（点击右上角的x或标签页的x）无法触发相应事件
    // 只会触发 page close，所以没办法
    this.browserSession.page.on('close', () => {
      emitter.emit('page-closed', { accountId: this.account.id })
    })

    // 直播结束自动停止：仅实现该能力的平台启用（抖音小店/巨量百应/测试平台）
    if (isLiveStatusWatcher(this.platform)) {
      this.platform.startLiveStatusWatch(() => this.handleLiveEnded())
    }

    // B2：attach 壳会话评论读取链路走 headless 真实 Chrome（失败不影响主流程）
    this.maybeStartCommentBackend()

    this.logger.success('成功与中控台建立连接')
  }

  /**
   * B2 评论后端启动（仅壳 attach 模式；launched 模式官方页评论本身可用，不重复启动）。
   * 读取链路：headless 真 Chrome 轮询 comment/info → 事件推送到壳内「直播互动」面板。
   * 失败只降级告警，绝不影响连接/任务主流程。
   */
  private maybeStartCommentBackend(): void {
    try {
      if (process.env.LM_COMMENT_BACKEND === '0') return
      const attached = this.browserSession
      if (!attached || attached.kind !== 'attached') return
      // 兼容测试/早期会话：page.url 不可用或非 http(s) 时跳过（后端接入绝不阻断连接）
      const pageUrl = (attached.page as { url?: () => string }).url
      if (typeof pageUrl !== 'function') return
      const consoleUrl = pageUrl.call(attached.page)
      if (!consoleUrl || !/^https?:/.test(consoleUrl)) return
      const accountId = this.account.id
      const partition = accountTabPartition(accountId)
      const pageRef = attached.page
      const logger = this.logger
      void commentBackendRegistry
        .ensure(accountId, {
          consoleUrl,
          getState: async () => ({
            cookies: await session.fromPartition(partition).cookies.get({}),
            localStorage: await pageRef
              .evaluate(() => {
                const out: Record<string, string> = {}
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i)
                  if (key) out[key] = localStorage.getItem(key) ?? ''
                }
                return out
              })
              .catch(() => ({})),
          }),
          createSession: async (storageState: string) => {
            const launched = await browserManager.createSession(
              true,
              JSON.parse(storageState) as StorageState,
            )
            return {
              page: launched.page,
              close: async () => {
                await launched.browser.close().catch(() => {})
              },
            }
          },
          onComment: comment =>
            windowManager.send(IPC_CHANNELS.tasks.commentBackend.comment, { accountId, comment }),
          onStatus: status =>
            windowManager.send(IPC_CHANNELS.tasks.commentBackend.status, { accountId, status }),
        })
        .then(status => {
          if (status.state === 'live') logger.success('B2 评论后端已连接（headless 真实 Chrome）')
          else logger.warn('B2 评论后端未就绪：', status.error ?? status.state)
        })
        .catch(e => logger.warn('B2 评论后端启动失败（不影响主流程）：', String(e).slice(0, 200)))
    } catch (e) {
      this.logger.warn('B2 评论后端接入跳过：', String(e).slice(0, 200))
    }
  }

  /**
   * 绑定「会话页是否仍在中控台」的导航观测（fix-shell-popup-navigation-liveend A2）。
   * - 幂等：同一 Page 只绑一次（WeakSet）；page 被替换后由调用方（connect/ensureAuthenticated/
   *   startTask）重新调用，绑到新的会话页；
   * - 仅主 frame：iframe（评论区/广告/支付）导航不改变「会话页身份」；
   * - 平台未实现 isControlPageUrl（可选契约）→ 不观测、不抛错（未适配平台零行为变化）；
   * - URL 畸形/平台判定异常 → 静默跳过本轮：导航观测永不影响会话主流程。
   */
  private observePageNavigation() {
    const page = this.browserSession?.page
    if (!page || this.observedPages.has(page)) return
    const predicate = this.platform.isControlPageUrl
    if (typeof predicate !== 'function') return
    const isControlPageUrl = predicate.bind(this.platform)
    this.observedPages.add(page)
    page.on('framenavigated', frame => {
      // 会话页已被替换（登录换页等）：旧 Page 的导航不再代表会话身份
      if (this.browserSession?.page !== page) return
      if (frame.parentFrame() !== null) return
      let isControl: boolean
      try {
        isControl = isControlPageUrl(frame.url())
      } catch {
        return
      }
      if (isControl) {
        // 回到中控台：清除离开状态，告警闸复位（下一段离开可再次提示）
        this.pageOffControl = false
        this.leaveControlWarned = false
        return
      }
      this.pageOffControl = true
      // 只在任务运行中打扰用户（没有任务时页面漂移无损失）；告警闸保证每段离开只提示一次
      if (this.activeTasks.size > 0) this.warnLeaveControlPage(frame.url())
    })
  }

  /** 会话页 URL（仅用于日志；页面已关闭/不可达时返回空串，绝不影响任务启动） */
  private currentPageUrl(): string {
    try {
      return this.browserSession?.page.url() ?? ''
    } catch {
      return ''
    }
  }

  /** 离开中控台告警（每段离开只发一次；回到控制页时由观测器复位告警闸） */
  private warnLeaveControlPage(url: string) {
    if (this.leaveControlWarned) return
    this.leaveControlWarned = true
    this.logger.warn('会话页已离开中控台，任务可能失效：', url.slice(0, 120))
    windowManager.sendTo('ui', IPC_CHANNELS.shell.warnToast, '中控台页面已离开，任务可能失效')
  }

  /**
   * 检测到真实下播（非暂停）的统一处理（fix-shell-popup-navigation-liveend A3 去破坏化）：
   * 先停 watcher（本方法不再断开会话，继续轮询只会基于失效页反复误判）→
   * 通知渲染层（「直播已结束」toast）→ 系统通知 → 停止全部任务。
   *
   * 关键契约：**不再 disconnect()**。下播判定可能因页面漂移/信号不可用而误判，旧实现把
   * 「停止任务」与「拆除会话+关闭壳内 Tab」耦合，误判的代价不可逆。会话与 Tab 保留，
   * 由用户手动断开（disconnect() 语义不变，仍走 teardownSession/disposeShell + disconnectedEvent）。
   */
  private handleLiveEnded() {
    if (this.liveEndedHandled) return
    this.liveEndedHandled = true
    if (isLiveStatusWatcher(this.platform)) {
      this.platform.stopLiveStatusWatch()
    }
    windowManager.send(IPC_CHANNELS.tasks.liveControl.liveEndedEvent, this.account.id)
    new Notification({
      title: '直播已结束',
      body: `账号「${this.account.name}」的直播已结束，所有任务已自动停止`,
    }).show()
    // 只停任务、保留会话：误判不再造成不可逆破坏；任务 stop 监听会自行从 activeTasks 移除
    Array.from(this.activeTasks.values()).forEach(task => {
      task.stop()
    })
    this.activeTasks.clear()
    this.logger.warn('检测到直播已结束，自动停止所有任务（会话与中控台页面保留，需手动断开）')
  }

  disconnect() {
    this.liveEndedHandled = true
    void commentBackendRegistry.stop(this.account.id).catch(() => {})
    if (isLiveStatusWatcher(this.platform)) {
      this.platform.stopLiveStatusWatch()
    }
    this.logger.warn('与中控台断开连接')
    // C1 守卫：统一经 teardownSession 按 kind 分派——
    // launched 结束浏览器进程（MacOS 下 context 关闭不杀进程，必须显式 close）；
    // attached 仅断 CDP 连接，绝不杀宿主（browser-shell-formalization-plan v3）
    teardownSession(this.browserSession!).catch(e => this.logger.error('无法结束会话：', e))
    // attached：拆除自己的壳承载体（窗口=关窗；单窗口=移除 pageView），
    // 对齐 launched 关浏览器的用户预期；只拆本会话的，不触碰其他 session
    if (this.browserSession?.kind === 'attached') {
      this.browserSession.disposeShell?.().catch(e => this.logger.error('无法关闭壳窗口：', e))
    }
    // 关闭所有正在进行的任务
    Array.from(this.activeTasks.values()).forEach(task => {
      task.stop()
    })
    this.activeTasks.clear()
    // 通知渲染层
    windowManager.send(IPC_CHANNELS.tasks.liveControl.disconnectedEvent, this.account.id)
  }

  private async ensureAuthenticated(
    session: BrowserSession,
    headless = true,
    mode: ExecMode = 'launch',
  ) {
    this.browserSession = session
    // 递归/换页后重新绑定身份观测（WeakSet 幂等；平台可能已在 login 中替换会话页）
    this.observePageNavigation()
    const isConnected = await this.platform.connect(this.browserSession)
    // 未登录，需要等待登录
    if (!isConnected) {
      if (mode === 'attach') {
        // 壳窗口天然有头，直接等待登录；登录态活在 partition，无需 storageState 搬运与模式切换
        await this.platform.login(this.browserSession)
        await this.ensureAuthenticated(this.browserSession, headless, mode)
        return
      }
      // 无头模式，需要先关闭原先的无头模式，启用有头模式给用户登录
      if (headless) {
        await this.browserSession.browser.close()
        this.logger.info('需要登录，请在打开的浏览器中登录')
        this.browserSession = await browserManager.createSession(false)
      }
      // 等待登录
      await this.platform.login(this.browserSession)
      // 保存登录状态
      const storageState = await this.browserSession.context.storageState()
      // 无头模式，需要先关闭当前的有头模式，重新打开无头模式
      if (headless) {
        await this.browserSession.browser.close()
        this.logger.info('登录成功，浏览器将继续以无头模式运行')
        this.browserSession = await browserManager.createSession(headless, storageState)
      }
      await this.ensureAuthenticated(this.browserSession, headless, mode)
    }
  }

  public async startTask(task: LiveControlTask): Result.ResultAsync<void, Error> {
    // 任务开跑前确认观测的是当前会话页（平台适配器可能在认证后替换 browserSession.page）
    this.observePageNavigation()
    // 会话页在任务启动前就已离开中控台（例如用户先点了功能页再开任务）：立即提示一次，
    // 避免任务静默跑在错误页面上；同段离开已提示过则不重复打扰。
    if (this.pageOffControl) {
      this.warnLeaveControlPage(this.currentPageUrl())
    }
    const newTask = makeTask(task, this.platform, this.account, this.logger)
    if (Result.isFailure(newTask)) {
      return newTask
    }
    // 任务停止时从任务列表中移除
    newTask.value.addStopListener(() => {
      this.activeTasks.delete(task.type)
    })
    await newTask.value.start()
    this.activeTasks.set(task.type, newTask.value)
    return Result.succeed()
  }

  public stopTask(taskType: LiveControlTask['type']) {
    const task = this.activeTasks.get(taskType)
    if (task) {
      task.stop()
    } else {
      this.logger.warn('无法停止任务：未找到正在运行中的任务')
    }
  }

  /** 导航离开护栏查询（guangquan-shell-ui-parity v3 · P2-6）：该账号是否有运行中任务 */
  public hasActiveTasks() {
    return this.activeTasks.size > 0
  }

  public async sendRedPacket(duration: string): Result.ResultAsync<void, Error> {
    if (!isSendRedPacket(this.platform)) {
      return Result.fail(
        new TaskNotSupportedError({
          taskName: '一键发红包',
          targetName: this.platform.platformName,
        }),
      )
    }
    return this.platform.sendRedPacket(duration)
  }

  public updateTaskConfig<T extends LiveControlTask>(
    type: T['type'],
    config: Partial<T['config']>,
  ): Result.Result<void, Error> {
    const task = this.activeTasks.get(type)
    if (task?.updateConfig) {
      return task.updateConfig(config)
    }
    return Result.fail(new TaskNotSupportedError({ taskName: `update-${type}` }))
  }
}

function makeTask<T extends LiveControlTask>(
  task: T,
  platform: IPlatform,
  account: Account,
  logger: ReturnType<typeof createLogger>,
): Result.Result<ITask, Error> {
  if (task.type === 'auto-popup' && isPerformPopup(platform)) {
    return createAutoPopupTask(platform, task.config, account, logger)
  }
  if (task.type === 'auto-comment' && isPerformComment(platform)) {
    return createAutoCommentTask(platform, task.config, account, logger)
  }
  if (task.type === 'send-batch-messages' && isPerformComment(platform)) {
    return createSendBatchMessageTask(platform, task.config, logger)
  }
  if (task.type === 'comment-listener' && isCommentListener(platform)) {
    return createCommentListenerTask(platform, task.config, account, logger)
  }
  if (task.type === 'pin-comment' && isPinComment(platform)) {
    return createPinCommentTask(platform, task.config.comment, account.id, logger)
  }
  return Result.fail(
    new TaskNotSupportedError({
      taskName: task.type,
      targetName: platform.platformName,
    }),
  )
}
