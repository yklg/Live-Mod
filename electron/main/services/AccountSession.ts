import { Result } from '@praha/byethrow'
import { Notification } from 'electron'
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
import { createAutoCommentTask } from '#/tasks/AutoCommentTask'
import { createAutoPopupTask } from '#/tasks/AutoPopupTask'
import { createCommentListenerTask } from '#/tasks/CommentListenerTask'
import type { ITask } from '#/tasks/ITask'
import { createPinCommentTask } from '#/tasks/PinCommentTask'
import { createSendBatchMessageTask } from '#/tasks/SendBatchMessageTask'
import windowManager from '#/windowManager'
import { shellWindowManager } from '#/windows/shellWindowManager'

export class AccountSession {
  private platform: IPlatform
  private browserSession: BrowserSession | null = null
  private activeTasks: Map<LiveControlTask['type'], ITask> = new Map()
  // 直播结束处理重入守卫：connect 置 false，disconnect 置 true（会话关闭后不再响应结束信号）
  private liveEndedHandled = true

  constructor(
    platformName: LiveControlPlatform,
    private account: Account,
    private logger = createLogger(`@${account.name}`),
  ) {
    this.platform = new platformFactory[platformName]()
  }

  async connect(config: { headless?: boolean; storageState?: string; mode?: ExecMode }) {
    this.liveEndedHandled = false
    const mode: ExecMode = config.mode ?? 'launch'
    let storageState: StorageState
    if (config.storageState) {
      this.logger.info('检测到已保存登录状态')
      storageState = JSON.parse(config.storageState)
    }

    // attach 模式：壳窗口 + CDP attach 回 Electron 自身（R1'）；登录态活在 partition，不搬运 storageState
    this.browserSession =
      mode === 'attach'
        ? await browserManager.createAttachedSession(this.account.id)
        : await browserManager.createSession(config.headless, storageState)

    await this.ensureAuthenticated(this.browserSession, config.headless, mode)

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

    this.logger.success('成功与中控台建立连接')
  }

  /**
   * 检测到真实下播（非暂停）的统一处理：
   * 通知渲染层（先于断开，保证「直播已结束」toast 在「已断开」之前）→ 系统通知 → 停止全部任务并断开
   */
  private handleLiveEnded() {
    if (this.liveEndedHandled) return
    this.liveEndedHandled = true
    this.logger.warn('检测到直播已结束，自动停止所有任务并断开连接')
    windowManager.send(IPC_CHANNELS.tasks.liveControl.liveEndedEvent, this.account.id)
    new Notification({
      title: '直播已结束',
      body: `账号「${this.account.name}」的直播已结束，所有任务已自动停止`,
    }).show()
    this.disconnect()
  }

  disconnect() {
    this.liveEndedHandled = true
    if (isLiveStatusWatcher(this.platform)) {
      this.platform.stopLiveStatusWatch()
    }
    this.logger.warn('与中控台断开连接')
    // C1 守卫：统一经 teardownSession 按 kind 分派——
    // launched 结束浏览器进程（MacOS 下 context 关闭不杀进程，必须显式 close）；
    // attached 仅断 CDP 连接，绝不杀宿主（browser-shell-formalization-plan v3）
    teardownSession(this.browserSession!).catch(e => this.logger.error('无法结束会话：', e))
    // attached：关闭自己的壳窗口（窗口层操作，对齐 launched 关浏览器的用户预期；
    // 只关本会话窗口，不触碰其他 session——所有权守卫见 teardown.test）
    if (this.browserSession?.kind === 'attached' && this.browserSession.shellWindowId != null) {
      shellWindowManager.get(this.browserSession.shellWindowId)?.close()
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
