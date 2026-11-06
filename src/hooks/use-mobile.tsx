import * as React from 'react'
import { BREAKPOINTS } from '@/constants'

/**
 * panel 模式判定（seamless-fix v3 · B.2）：壳单窗口右侧面板 ?view=panel
 * （search 参数或 hash 路由内查询串均可读）。消费点唯一：sidebar.tsx 的 useIsMobile。
 */
export function isPanelMode(search: string, hash: string): boolean {
  if (readViewParam(search) === 'panel') return true
  const qi = hash.indexOf('?')
  return qi >= 0 && readViewParam(hash.slice(qi + 1)) === 'panel'
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
