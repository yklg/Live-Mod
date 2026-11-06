// fold 失败模式定档（seamless-fix v3 · A1-Q6）：
// loadURL 抛错或超时 → 回退纯 deny + 日志 fold-fallback-deny，页面停留原 URL，禁止半导航状态。
export type FoldResult = 'fold-ok' | 'fold-fallback-deny'

export interface FoldParams {
  loadURL: (url: string) => Promise<void>
  url: string
  timeoutMs: number
  log: (msg: string) => void
}

export async function foldNavigate({
  loadURL,
  url,
  timeoutMs,
  log,
}: FoldParams): Promise<FoldResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  // 先把 loadURL 的 reject 映射成值，避免 race 之外的悬挂 rejection
  const load = loadURL(url).then(
    () => 'ok' as const,
    () => 'error' as const,
  )
  try {
    const r = await Promise.race([load, timeout])
    if (r === 'ok') {
      log(`popup-rule=fold fold-ok url=${url.slice(0, 80)}`)
      return 'fold-ok'
    }
    log(
      `popup-rule=fold fold-fallback-deny reason=${r === 'timeout' ? 'timeout' : 'loadURL-error'}，页面停留原 URL url=${url.slice(0, 80)}`,
    )
    return 'fold-fallback-deny'
  } finally {
    clearTimeout(timer)
  }
}
