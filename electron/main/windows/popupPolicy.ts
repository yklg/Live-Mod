// 弹窗三段决策（seamless-fix v3 · A1）——纯函数，shellUI(view 档) 与 shellWindowManager(window 档) 共同消费。
// 双承载体策略并存属平台约束驱动（view 弹窗销毁 webContents / window 无此问题），
// 见 shellWindowManager A3 注释互引；Phase 3 末裁决窗口模式退役前禁止"统一化"误改。
export type PopupCarrier = 'view' | 'window'
export type PopupDecision = 'deny-selfdup' | 'fold' | 'external' | 'allow'

export interface PopupInput {
  currentUrl: string
  popupUrl: string
  carrier: PopupCarrier
  /** 平台层注入的本平台可信域名后缀（登录/中控链路跨域白名单）。
   *  A5 边界：域名知识只属于平台层，壳层不得内建平台域名表——此处仅做后缀匹配消费。 */
  ownedOrigins?: readonly string[]
}

/**
 * 分类只看 host+path（I16：query/hash 忽略、host 大小写与默认端口由 URL 解析归一、
 * 非默认 port 参与 host 比较、pathname 尾斜杠归一）。
 * 任何无法分类的输入（畸形/当前页非 http(s)，含 about:blank#nonce 寻址阶段）归最保守档
 * deny-selfdup（I18：纯拒绝，不 fold 不外开）。
 */
export function classifyPopup({
  currentUrl,
  popupUrl,
  carrier,
  ownedOrigins,
}: PopupInput): PopupDecision {
  const cur = parseHttp(currentUrl)
  const pop = parseHttp(popupUrl)
  if (!cur || !pop) return 'deny-selfdup'
  // 同 host + 同 pathname = 自复制（framebuster/反嵌入逃逸特征）→ 纯拒绝，页面留壳内
  if (cur.host === pop.host && normPath(cur.pathname) === normPath(pop.pathname)) {
    return 'deny-selfdup'
  }
  // window 承载体保持 allow（Phase 1 launched 语义行为锚，防误统一）
  if (carrier === 'window') return 'allow'
  // view 承载体：同 host 异 path 业务弹窗折入当前页
  if (cur.host === pop.host) return 'fold'
  // 跨域但属本平台可信域（如百应登录 douyinec.com ↔ buyin.jinritemai.com）→ 折入壳内，
  // 否则 attach 登录链路会逃逸到系统浏览器（真实缺陷：入口一键选百应 → 外部 Edge 打开登录页）
  if (isOwnedHost(pop.host, ownedOrigins)) return 'fold'
  return 'external'
}

/** 后缀匹配必须带点边界：eviljinritemai.com 不得命中 jinritemai.com */
function isOwnedHost(host: string, origins?: readonly string[]): boolean {
  if (!origins?.length) return false
  const lower = host.toLowerCase()
  return origins.some(o => {
    const suffix = o.toLowerCase()
    return lower === suffix || lower.endsWith(`.${suffix}`)
  })
}

function parseHttp(u: string): URL | null {
  try {
    const url = new URL(u)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function normPath(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}
