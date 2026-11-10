import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PanelSummary({
  icon,
  title,
  subtitle,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[54px] items-center gap-2 rounded-card border-hairline border-border bg-card px-3 py-2.5 shadow-elevation-1',
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1 leading-[17px]">
        <div className="truncate text-[13px] font-semibold">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

export function PanelSection({
  label,
  children,
  className,
}: {
  label?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      data-slot="panel-section"
      className={cn(
        'rounded-card border-hairline border-border bg-card px-3 py-3 shadow-elevation-1',
        className,
      )}
    >
      {label && (
        <div className="mb-1.5 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </div>
      )}
      {children}
    </section>
  )
}

export function PanelRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-10 items-center gap-2 border-t border-border/70 py-2 first:border-t-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
