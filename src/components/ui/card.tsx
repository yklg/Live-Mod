import type * as React from 'react'
import { cn } from '@/lib/utils'

function Card({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      data-slot="card"
      className={cn(
        'rounded-card border-hairline border-border bg-card text-card-foreground shadow-elevation-1',
        className,
      )}
      {...props}
    />
  )
}
Card.displayName = 'Card'

function CardHeader({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn('flex flex-col space-y-1 px-3 pt-3 pb-2', className)}
      {...props}
    />
  )
}
CardHeader.displayName = 'CardHeader'

function CardTitle({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cn('font-semibold text-sm leading-[18px] tracking-tight', className)}
      {...props}
    />
  )
}
CardTitle.displayName = 'CardTitle'

function CardDescription({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cn('text-xs leading-[18px] text-muted-foreground', className)}
      {...props}
    />
  )
}
CardDescription.displayName = 'CardDescription'

function CardContent({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn('px-3 pt-0 pb-3', className)}
      {...props}
    />
  )
}
CardContent.displayName = 'CardContent'

function CardFooter({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return <div ref={ref} className={cn('flex items-center px-3 pt-0 pb-3', className)} {...props} />
}
CardFooter.displayName = 'CardFooter'

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
