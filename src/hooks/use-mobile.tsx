import * as React from 'react'
import { BREAKPOINTS } from '@/constants'

/**
 * panel/rail 模式判定：seamless-fix v3 的 ?view=panel 分栏 + guangquan-shell-ui-parity v3 的
 * rail 入口豁免（railView 内嵌页在 800px 面板不降级移动布局）。
 * （search 参数或 hash 路由内查询串均可读）。消费点唯一：sidebar.tsx 的 useIsMobile。
 */
export function isPanelMode(search: string, hash: string): boolean {
  if (isExemptView(readViewParam(search))) return true
  const qi = hash.indexOf('?')
  return qi >= 0 && isExemptView(readViewParam(hash.slice(qi + 1)))
}

// 兼容期双值：panel（v3 分栏退役前）与 rail（光圈式入口）
function isExemptView(view: string | null): boolean {
  return view === 'panel' || view === 'rail'
}

function readViewParam(query: string): string | null {
  return new URLSearchParams(query.replace(/^\?/, '')).get('view')
}

export function useIsMobile() {
  // panel 模式豁免：640px 面板以桌面布局渲染侧栏（256 展开），不降级 off-canvas Sheet；
  // 经典模式（无 view=panel）行为零变化。
  const panelMode = isPanelMode(window.location.search, window.location.hash)
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    if (panelMode) {
      setIsMobile(false)
      return
    }
    const mql = window.matchMedia(`(max-width: ${BREAKPOINTS.MOBILE - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < BREAKPOINTS.MOBILE)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < BREAKPOINTS.MOBILE)
    return () => mql.removeEventListener('change', onChange)
  }, [panelMode])

  return panelMode ? false : !!isMobile
}
