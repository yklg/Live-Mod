import { Monitor, Moon, Sun } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ThemeMode, useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

/** 外观设置：主题三档切换（浅色 / 深色 / 跟随系统） */
export function AppearanceSetting() {
  const { mode, setMode } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>选择界面主题，跟随系统时将自动随操作系统外观切换</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="inline-flex rounded-lg bg-muted p-1">
          {OPTIONS.map(option => {
            const Icon = option.icon
            const active = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                  active
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
