// 运行时降级状态（browser-shell-formalization-plan v3 · A2）
// 内存态 + TTL：进程重启即失效、下次连接重探；永不回写 defaultEnvMatrix（TC-U5 固化）。
// F3（CDP 不可达/降级）与 F4（stealth 注入失败）的标记消费者。
export interface RuntimeEnvState {
  degrade(platform: string): void
  isDegraded(platform: string): boolean
  clear(platform: string): void
  markStealthOff(platform: string): void
  isStealthOff(platform: string): boolean
}

export function createRuntimeEnvState(opts: { ttlMs: number }): RuntimeEnvState {
  const expiries = new Map<string, number>()
  const stealthOff = new Set<string>()

  return {
    degrade(platform) {
      expiries.set(platform, Date.now() + opts.ttlMs)
    },
    isDegraded(platform) {
      const expiry = expiries.get(platform)
      if (expiry === undefined) return false
      if (Date.now() > expiry) {
        expiries.delete(platform)
        return false
      }
      return true
    },
    clear(platform) {
      expiries.delete(platform)
    },
    markStealthOff(platform) {
      stealthOff.add(platform)
    },
    isStealthOff(platform) {
      return stealthOff.has(platform)
    },
  }
}

/** 应用级单例：TTL 10 分钟——降级冷却后自动给 attach 重探机会 */
export const runtimeEnvState = createRuntimeEnvState({ ttlMs: 10 * 60 * 1000 })
