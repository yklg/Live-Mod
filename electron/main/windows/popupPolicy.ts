// 弹窗三段决策（seamless-fix v3 · A1）——纯函数，shellUI(view 档) 与 shellWindowManager(window 档) 共同消费。
// 双承载体策略并存属平台约束驱动（view 弹窗销毁 webContents / window 无此问题），
// 见 shellWindowManager A3 注释互引；Phase 3 末裁决窗口模式退役前禁止"统一化"误改。
export type PopupCarrier = 'view' | 'window'
export type PopupDecision = 'deny-selfdup' | 'fold' | 'external' | 'allow'

export interface PopupInput {
  currentUrl: string
  popupUrl: string
  carrier: PopupCarrier
}

/**
 * 分类只看 host+path（I16：query/hash 忽略、host 大小写与默认端口由 URL 解析归一、
 * 非默认 port 参与 host 比较、pathname 尾斜杠归一）。
 * 任何无法分类的输入（畸形/当前页非 http(s)，含 about:blank#nonce 寻址阶段）归最保守档
 * deny-selfdup（I18：纯拒绝，不 fold 不外开）。
 */
export function classifyPopup({ currentUrl, popupUrl, carrier }: PopupInput): PopupDecision {
  const cur = parseHttp(currentUrl)
  const pop = parseHttp(popupUrl)
  if (!cur || !pop) return 'deny-selfdup'
  // 同 host + 同 pathname = 自复制（framebuster/反嵌入逃逸特征）→ 纯拒绝，页面留壳内
  if (cur.host === pop.host && normPath(cur.pathname) === normPath(pop.pathname)) {
    return 'deny-selfdup'
  }
  // window 承载体保持 allow（Phase 1 launched 语义行为锚，防误统一）
  if (carrier === 'window') return 'allow'
  // view 承载体：同 host 异 path 业务弹窗折入当前页；异 host 外链走系统浏览器
  return cur.host === pop.host ? 'fold' : 'external'
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
