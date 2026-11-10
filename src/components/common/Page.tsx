import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { isShellPanelView } from '@/shell/lib/panelMode'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  /** 提供时在标题前渲染返回按钮 */
  back?: () => void
}

export function PageHeader({ title, description, actions, back }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {back && (
          <button
            type="button"
            onClick={back}
            aria-label="返回"
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control border-hairline border-border bg-background transition-colors hover:bg-accent"
          >
            <ArrowLeft className="size-3.5" />
          </button>
        )}
        <div className="min-w-0">
          <h1
            data-testid="page-title"
            className="text-[15px] leading-[22px] font-semibold tracking-tight"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-xs leading-[18px] text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

interface PageProps extends PageHeaderProps {
  /** full：内容区填满剩余高度（页面内部自行滚动），用于对话/双栏流式页面 */
  full?: boolean
  /** narrow：内容限宽 2xl 居中，用于简单表单页（如发红包） */
  narrow?: boolean
  /** panel：壳右栏内由 ShellRail 头承载标题；只有 back/actions 时保留紧凑动作行 */
  panelHeader?: 'hidden' | 'compact'
  children: ReactNode
  className?: string
}

/**
 * 全站统一页面骨架：页头（标题/说明/操作）固定在顶部，内容区为唯一滚动体。
 * form 模式（默认）内容限宽 5xl；narrow 限宽 2xl；full 模式填满高度交给页面布局。
 * 壳右栏内 Page 不再重复 h1/描述（ShellRail 头是唯一标题源）。
 */
export function Page({
  title,
  description,
  actions,
  back,
  full = false,
  narrow = false,
  panelHeader = 'hidden',
  children,
  className,
}: PageProps) {
  const panel = isShellPanelView()
  const compactHeader = panel && (panelHeader === 'compact' || Boolean(back || actions))
  const hideHeader = panel && !compactHeader
  return (
    <div className={cn('flex h-full flex-col', className)}>
      {!hideHeader && (
        <div className={cn('shrink-0', compactHeader ? 'px-3 pt-3 pb-2' : 'px-4 pt-4 pb-3')}>
          {compactHeader ? (
            <div className="flex items-start justify-between gap-3">
              {back ? (
                <button
                  type="button"
                  onClick={back}
                  aria-label="返回"
                  className="flex size-7 shrink-0 items-center justify-center rounded-control border-hairline border-border bg-background transition-colors hover:bg-accent"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
              ) : (
                <span />
              )}
              {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
          ) : (
            <PageHeader title={title} description={description} actions={actions} back={back} />
          )}
        </div>
      )}
      {full ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <div
          data-testid="page-scroll"
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        >
          <div
            className={cn(
              'mx-auto w-full',
              panel ? 'px-3 pb-4' : 'px-4 pb-6',
              !panel && (narrow ? 'max-w-2xl' : 'max-w-5xl'),
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
