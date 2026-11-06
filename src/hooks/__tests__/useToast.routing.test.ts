import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ===== useToast 壳模式路由集成（shell-ui-polish v3 · TC-RT-02/03）=====
// 契约：壳模式 success/error(string) 只 invoke shell:notify（不写本地 store）；
//       经典模式只写本地 store（invoke 0 次）。用 window 桩驱动 module-level 路由判定。
const invoke = vi.fn(async () => ({ ok: true }))

function stubWindow(view?: { name: string; shellUi: boolean }) {
  vi.stubGlobal('window', {
    __lmView: view,
    ipcRenderer: { invoke },
  })
}

describe('useToast 壳模式路由（TC-RT-02/03）', () => {
  beforeEach(() => {
    invoke.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('TC-RT-02 壳模式（rail）：success/error 各 invoke 一次 shell:notify，返回通知桩', async () => {
    stubWindow({ name: 'rail', shellUi: true })
    const { useToast } = await import('@/hooks/useToast')
    const { toast } = useToast()
    const a = toast.success('已连接')
    const b = toast.error('连接失败')
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenNthCalledWith(1, 'shell:notify', {
      variant: 'success',
      description: '已连接',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'shell:notify', {
      variant: 'error',
      description: '连接失败',
    })
    expect(a.id).toBe('shell-notice')
    expect(b.id).toBe('shell-notice')
  })

  it('TC-RT-03 经典模式（index）：不 invoke，走本地 toast（返回本地 id）', async () => {
    stubWindow({ name: 'index', shellUi: false })
    const { useToast } = await import('@/hooks/useToast')
    const { toast } = useToast()
    const a = toast.error('经典失败')
    expect(invoke).not.toHaveBeenCalled()
    expect(a.id).not.toBe('shell-notice')
  })

  it('TC-RT-03b 无 window.__lmView（边界）：不 invoke，保守走本地', async () => {
    stubWindow(undefined)
    const { useToast } = await import('@/hooks/useToast')
    const { toast } = useToast()
    toast.success('x')
    expect(invoke).not.toHaveBeenCalled()
  })
})
