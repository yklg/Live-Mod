import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  /** 提供时在标题前渲染返回按钮 */
  back?: () => void
}

export function PageHeader({ title, description, actions, back }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2.5">
        {back && (
          <button
            type="button"
            onClick={back}
            aria-label="返回"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0">
          <h1
            data-testid="page-title"
            className="text-xl font-semibold tracking-tight @xl/panel:text-base"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-[13px] text-muted-foreground @xl/panel:text-xs">
              {description}
            </p>
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
  children: ReactNode
  className?: string
}

/**
 * 全站统一页面骨架：页头（标题/说明/操作）固定在顶部，内容区为唯一滚动体。
 * form 模式（默认）内容限宽 5xl；narrow 限宽 2xl；full 模式填满高度交给页面布局。
 */
export function Page({
  title,
  description,
  actions,
  back,
  full = false,
  narrow = false,
  children,
  className,
}: PageProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="shrink-0 px-6 pb-4 pt-5 @xl/panel:px-4 @xl/panel:pb-3 @xl/panel:pt-4">
        <PageHeader title={title} description={description} actions={actions} back={back} />
      </div>
      {full ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <div
          data-testid="page-scroll"
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        >
          <div
            className={cn(
              'mx-auto w-full px-6 pb-8 @xl/panel:px-4 @xl/panel:pb-6',
              narrow ? 'max-w-2xl' : 'max-w-5xl',
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
