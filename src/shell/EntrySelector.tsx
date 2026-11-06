// 壳入口平台选择器（shell-entry-platform-selector v1）
// 设计口径：全新选择器（参考对标软件的信息结构，视觉全部用本仓库令牌，见 UI_STYLE_GUIDE.md）。
// 数据流（单向）：entryCatalog(invoke) → 渲染；卡片点击 → entrySelect(invoke) → 主进程校验/记忆/派发；
// 「暂不进入」→ entrySkip。本组件不持有连接逻辑，连接由 rail 业务树消费 entryIntent 执行。
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const PLATFORM_ICON_BASE = './platform-icons'

function useEntryCatalog() {
  const [catalog, setCatalog] = useState<ShellEntryCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setCatalog(await window.ipcRenderer.invoke(IPC_CHANNELS.shell.entryCatalog))
    } catch (e) {
      setError(e instanceof Error ? e.message : '平台目录加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { catalog, error, loading, reload: load }
}

export function EntrySelector() {
  const { catalog, error, loading, reload } = useEntryCatalog()
  const [remember, setRemember] = useState(true)
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 记忆态到达后再对齐开关（默认开；只有明确关闭过才关）
  useEffect(() => {
    if (catalog) setRemember(catalog.remembered.autoRestore)
  }, [catalog])

  const handleSelect = useCallback(
    async (platform: LiveControlPlatform) => {
      if (busyPlatform) return
      setBusyPlatform(platform)
      setActionError(null)
      try {
        const result = await window.ipcRenderer.invoke(IPC_CHANNELS.shell.entrySelect, {
          platform,
          remember,
        })
        if (result?.ok) return // 主进程已隐藏入口并派发连接意图
        setActionError(
          result?.reason === 'shell-disabled'
            ? '当前不是壳界面模式，无法使用入口选择器'
            : '该平台暂不支持壳内直连，请稍后重试',
        )
      } catch (e) {
        setActionError(e instanceof Error ? e.message : '选择平台失败')
      } finally {
        setBusyPlatform(null)
      }
    },
    [busyPlatform, remember],
  )

  const handleSkip = useCallback(() => {
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.entrySkip)
  }, [])

  return (
    <div
      data-testid="entry-root"
      className="flex h-screen w-screen flex-col items-center justify-center overflow-auto bg-background p-10 text-foreground"
    >
      <div className="w-full max-w-[1000px]">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide">选择要连接的平台</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            选择后将直接在壳内打开对应直播控制台，无需外部浏览器
          </p>
        </header>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载平台列表…
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-4 py-16">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              <RefreshCw className="mr-2 size-3.5" />
              重试
            </Button>
          </div>
        )}

        {!loading && catalog && (
          <>
            <div className="grid grid-cols-3 gap-4">
              {catalog.platforms.map(platform => {
                const busy = busyPlatform === platform.id
                return (
                  <button
                    key={platform.id}
                    type="button"
                    data-platform={platform.id}
                    disabled={busyPlatform !== null}
                    onClick={() => void handleSelect(platform.id)}
                    className="rounded-lg border border-border bg-card p-5 text-left transition-colors duration-150 hover:border-muted-foreground hover:shadow-sm disabled:pointer-events-none disabled:opacity-60"
                  >
                    <div className="flex items-start gap-3.5">
                      <img
                        src={`${PLATFORM_ICON_BASE}/${platform.icon}.png`}
                        alt={platform.label}
                        className="size-12 shrink-0 rounded-[11px] object-contain"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-semibold">{platform.label}</span>
                          {platform.attachSupported && (
                            <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                              壳内直连
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {platform.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                      <span>{busy ? '正在进入…' : '未登录将先进入扫码登录页'}</span>
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : '进入'}
                        {!busy && <ArrowRight className="size-3.5" />}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-6 flex items-center gap-3.5 rounded-lg border border-border bg-muted px-4 py-3.5">
              <Switch
                data-testid="entry-remember"
                checked={remember}
                onCheckedChange={setRemember}
                aria-label="启动时自动进入（记住选择）"
              />
              <div>
                <p className="text-sm font-medium">启动时自动进入（记住选择）</p>
                <p className="text-xs text-muted-foreground">
                  下次启动将跳过此页，直接进入上次选择的平台
                </p>
              </div>
            </div>

            {actionError && <p className="mt-3 text-center text-xs text-destructive">{actionError}</p>}

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button
                data-testid="entry-skip"
                variant="outline"
                size="sm"
                onClick={handleSkip}
                disabled={busyPlatform !== null}
              >
                暂不进入
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                选择后随时可在「中控台」面板点击「切换平台」重新选择
                <br />
                首次连接需在壳内登录页完成扫码登录，登录态将保存在本机
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
