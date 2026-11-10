import type * as React from 'react'
import { cn } from '@/lib/utils'

const Input = ({ className, type, ...props }: React.ComponentProps<'input'>) => {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        'flex h-8 w-full rounded-control border-hairline border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
      onKeyDown={e => {
        e.stopPropagation()
        props.onKeyDown?.(e)
      }}
    />
  )
}
Input.displayName = 'Input'

export { Input }
