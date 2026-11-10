// 运行时环境状态（browser-shell-formalization-plan v3 · A2）
//
// 壳 v3 · Wave 1（计划 §3.3）：删除「降级」这一支。
// 原先这里有 degrade / isDegraded / clear（带 TTL 的运行时降级标记），
// 它与 envMatrix 的裁决链配合，实现了"attach 失败自动换外部浏览器"。
// 现在降级整体下线：attach 失败就是失败，如实上报，不换形态。
//
// 注意命名：评论链路（staleWatcher / RealChromeCommentBackend / contracts）里也有
// "degraded"，那是「评论数据陈旧」的业务状态，与本文件无关，**禁止**一并替换。
//
// 保留 markStealthOff / isStealthOff：BrowserSessionManager 在用（F4 stealth 注入失败标记）。
export interface RuntimeEnvState {
  markStealthOff(platform: string): void
  isStealthOff(platform: string): boolean
}

export function createRuntimeEnvState(): RuntimeEnvState {
  const stealthOff = new Set<string>()

  return {
    markStealthOff(platform) {
      stealthOff.add(platform)
    },
    isStealthOff(platform) {
      return stealthOff.has(platform)
    },
  }
}

/** 应用级单例 */
export const runtimeEnvState = createRuntimeEnvState()
