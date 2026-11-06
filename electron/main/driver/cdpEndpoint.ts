// CDP endpoint 解析（browser-shell-formalization-plan v3 · Phase 0）
// 外部经验（M7）：connectOverCDP 失败绝大多数是 endpoint shape / 浏览器未就绪——
// 因此本模块的铁律是：任何畸形输入都归约为 { ok:false, reason }（F3 降级信号），禁止裸抛。
export interface CdpEndpointInput {
  isDev: boolean
  env: Record<string, string | undefined>
  readPortFile: () => string | null
}

export interface CdpEndpointResult {
  ok: boolean
  port?: number
  wsEndpoint?: string
  reason?: 'port-file-missing' | 'port-file-malformed' | 'port-invalid' | 'port-file-unreadable'
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

export function resolveCdpEndpoint(input: CdpEndpointInput): CdpEndpointResult {
  // dev 显式固定端口优先（harness 复用约定 LM_CDP_PORT）
  const envPort = input.env.LM_CDP_PORT
  if (envPort !== undefined && envPort !== '') {
    const port = Number(envPort)
    if (!validPort(port)) return { ok: false, reason: 'port-invalid' }
    return { ok: true, port, wsEndpoint: `http://127.0.0.1:${port}` }
  }

  let raw: string | null = null
  try {
    raw = input.readPortFile()
  } catch {
    return { ok: false, reason: 'port-file-unreadable' }
  }
  if (raw === null || raw === '') return { ok: false, reason: 'port-file-missing' }

  const [line1, line2] = raw.split('\n')
  const port = Number(line1?.trim())
  if (!Number.isInteger(port)) return { ok: false, reason: 'port-file-malformed' }
  if (!validPort(port)) return { ok: false, reason: 'port-invalid' }
  if (!line2 || !line2.trim().startsWith('/')) return { ok: false, reason: 'port-file-malformed' }

  return { ok: true, port, wsEndpoint: `http://127.0.0.1:${port}${line2.trim()}` }
}
