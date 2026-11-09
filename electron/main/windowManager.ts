// utils/windowManager.js
import type { WebContents } from 'electron'
import type { IpcChannels } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'

/**
 * 具名推送目标（A4：显式路由，无通道前缀魔法字符串）
 * 注：本模块**不 import electron 运行时**（仅 `import type`），因此可直接在 vitest(node) 中实例化。
 * 保持这一点是 windowManager 可测的前提 —— 不要在类内 `import { app } from 'electron'`。
 */
export type PushTarget = 'ui' | 'chrome' | 'notice'

/** 每个目标最多缓存的待发事件数 */
const QUEUE_CAPACITY = 32
/** 待发事件存活时间：超过即视为过期（目标可能永远不会就绪，不能无限攒） */
const QUEUE_TTL_MS = 30_000

/**
 * 入队白名单：丢一次就会让用户看到错误状态、且无法靠"再拉一次"补救的事件。
 * 判定依据（见计划 §7 全量表）：
 *   - 关键：登录态持久化、断开/下播、账号名、模型列表、更新流程、按钮停止态
 *   - 不入队：可回放（评论快照 store）、可拉取（tabsState/railState）、可重试（aiChat stream）、
 *             日志（入队=递归风险）、入口意图（可重选）、提示 toast（可丢）
 */
const QUEUE_WHITELIST: ReadonlySet<string> = new Set<string>([
  IPC_CHANNELS.chrome.saveState,
  IPC_CHANNELS.app.providersUpdated,
  IPC_CHANNELS.tasks.liveControl.disconnectedEvent,
  IPC_CHANNELS.tasks.liveControl.liveEndedEvent,
  IPC_CHANNELS.tasks.liveControl.notifyAccountName,
  IPC_CHANNELS.tasks.autoMessage.stoppedEvent,
  IPC_CHANNELS.tasks.autoPopUp.stoppedEvent,
  IPC_CHANNELS.tasks.autoReply.listenerStopped,
  // B2 评论后端：初始评论可能在 railView 加载完成前到达（connect() 紧接着 maybeStartCommentBackend），
  // 不入队的话首波评论直接丢失；TTL 30s 足够 rail 完成挂载。
  IPC_CHANNELS.tasks.commentBackend.comment,
  IPC_CHANNELS.tasks.commentBackend.status,
])

/** 前缀白名单：更新流程 7 个通道都是关键事件，逐条列举易漏 */
const QUEUE_PREFIXES: readonly string[] = ['updater:']

function shouldQueue(channel: string): boolean {
  return QUEUE_WHITELIST.has(channel) || QUEUE_PREFIXES.some(prefix => channel.startsWith(prefix))
}

interface PendingPush {
  channel: string
  args: unknown[]
  at: number
}

export type WindowManagerDeps = {
  /** 注入时钟（单测用，避免 sleep） */
  now?: () => number
  /** 告警输出口：**不能走 logger** —— logger 自身经 send 推送，失败告警会无限递归 */
  writeStderr?: (line: string) => void
}

export class WindowManager {
  /** 壳容器模式（Phase 2）：React 应用迁移出主窗口 webContents，main→renderer 推送改路由到具名目标。
   *  ui = 业务树（v3 分栏 panelView / 光圈式 railView）；chrome = 壳顶栏入口；
   *  notice = 壳级通知覆盖层（shell-ui-polish v3，全窗透明 HUD）。 */
  private targets: Partial<Record<PushTarget, WebContents>> = {}
  private pending: Partial<Record<PushTarget, PendingPush[]>> = {}

  /** 连续投递失败次数：>0 表示当前处于故障态（首次进入时打一条 stderr，恢复后清零） */
  private failureStreak = 0
  /** 队列告警限频（丢弃/溢出各只报一次，避免刷屏） */
  private queueWarned = { drop: false, overflow: false, expired: false }

  private readonly now: () => number
  private readonly writeStderr: (line: string) => void

  constructor(deps: WindowManagerDeps = {}) {
    this.now = deps.now ?? Date.now
    this.writeStderr = deps.writeStderr ?? ((line: string) => void process.stderr.write(line))
  }

  setUITarget(wc: WebContents) {
    this.setTarget('ui', wc)
  }

  setTarget(name: PushTarget, wc: WebContents) {
    // 旧引用已销毁则先摘掉，避免误判为"目标可用"
    const prev = this.targets[name]
    if (prev && prev.isDestroyed()) delete this.targets[name]
    this.targets[name] = wc
    this.queueWarned = { drop: false, overflow: false, expired: false }
    this.flush(name)
  }

  clearUITarget() {
    this.targets = {}
  }

  /** 仅测试用：清空全部状态（单例跨用例复用时不残留） */
  resetForTest() {
    this.targets = {}
    this.pending = {}
    this.failureStreak = 0
    this.queueWarned = { drop: false, overflow: false, expired: false }
  }

  /** 诊断用：待发队列长度（不暴露内容，避免泄漏业务数据到日志） */
  getQueueDepth(target: PushTarget): number {
    return this.pending[target]?.length ?? 0
  }

  send<Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): boolean {
    return this.sendTo('ui', channel, ...args)
  }

  /**
   * 返回值语义（契约）：
   * - `true`  已成功交给目标 webContents.send
   * - `false` 未投递成功（已入队等待，或按策略丢弃）
   * 调用方若需要区分「入队」与「丢弃」，用 `getQueueDepth` 诊断 —— 不为这个细分把返回值改成枚举，
   * 44 处调用点不值得为此改动。
   */
  sendTo<Channel extends keyof IpcChannels>(
    target: PushTarget,
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): boolean {
    const named = this.targets[target]

    if (named && !named.isDestroyed()) {
      try {
        named.send(channel, ...args)
        this.onDelivered()
        return true
      } catch (e) {
        this.noteFailure(target, String(channel), e)
      }
    } else if (named) {
      // 目标已销毁：摘掉引用，避免后续每次判断都命中死对象
      delete this.targets[target]
    }

    // 关键：**不做任何隐式回退**（历史缺陷 P0-3：曾回退到主窗口 webContents，而壳模式下主窗口
    // 是不加载内容的纯容器，事件会静默进黑洞且无任何错误信号）。
    this.enqueue(target, String(channel), args as unknown[])
    return false
  }

  private onDelivered() {
    this.failureStreak = 0
  }

  private noteFailure(target: PushTarget, channel: string, err: unknown) {
    this.failureStreak++
    // 只在"首次进入故障态"打一条：连续 100 次失败也只产生 1 条 stderr，且绝不递归
    if (this.failureStreak === 1) {
      this.writeStderr(
        `[windowManager] 推送失败 target=${target} channel=${channel}（后续同类失败不再重复）: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      )
    }
  }

  private enqueue(target: PushTarget, channel: string, args: unknown[]) {
    if (!shouldQueue(channel)) {
      if (!this.queueWarned.drop) {
        this.queueWarned.drop = true
        this.writeStderr(
          `[windowManager] 目标未就绪，丢弃非关键事件 target=${target} channel=${channel}（同类仅报一次）\n`,
        )
      }
      return
    }

    let queue = this.pending[target]
    if (!queue) {
      queue = []
      this.pending[target] = queue
    }
    queue.push({ channel, args, at: this.now() })

    if (queue.length > QUEUE_CAPACITY) {
      const dropped = queue.shift()
      if (!this.queueWarned.overflow) {
        this.queueWarned.overflow = true
        this.writeStderr(
          `[windowManager] 待发队列溢出 target=${target} capacity=${QUEUE_CAPACITY}，丢弃最旧 ${
            dropped?.channel ?? '-'
          }（同类仅报一次）\n`,
        )
      }
    }
  }

  private flush(target: PushTarget) {
    const queue = this.pending[target]
    if (!queue || queue.length === 0) return
    const wc = this.targets[target]
    if (!wc || wc.isDestroyed()) return

    const now = this.now()
    const keep: PendingPush[] = []
    let expired = 0

    for (const item of queue) {
      if (now - item.at > QUEUE_TTL_MS) {
        expired++
        continue
      }
      try {
        wc.send(item.channel, ...(item.args as never[]))
        this.onDelivered()
      } catch (e) {
        this.noteFailure(target, item.channel, e)
        keep.push(item)
      }
    }

    if (expired > 0 && !this.queueWarned.expired) {
      this.queueWarned.expired = true
      this.writeStderr(
        `[windowManager] 待发事件过期丢弃 target=${target} count=${expired} ttl=${QUEUE_TTL_MS}ms（同类仅报一次）\n`,
      )
    }

    if (keep.length > 0) this.pending[target] = keep
    else delete this.pending[target]
  }
}

export default new WindowManager()
