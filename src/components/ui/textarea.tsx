import type * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = ({ className, ...props }: React.ComponentProps<'textarea'>) => {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-[60px] w-full rounded-control border-hairline border-input bg-transparent px-2.5 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
Textarea.displayName = 'Textarea'

export { Textarea }
