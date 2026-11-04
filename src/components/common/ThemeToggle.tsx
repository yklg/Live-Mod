import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { type ThemeMode, useTheme } from '@/hooks/useTheme'

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

export function ThemeToggle() {
  const { mode, setMode } = useTheme()
  const current = OPTIONS.find(option => option.value === mode) ?? OPTIONS[2]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {mode === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          <span>{current.label}</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-40 p-1.5">
        <RadioGroup
          value={mode}
          onValueChange={value => setMode(value as ThemeMode)}
          className="gap-0.5"
        >
          {OPTIONS.map(option => (
            <label
              key={option.value}
              htmlFor={`theme-${option.value}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-accent"
            >
              <RadioGroupItem value={option.value} id={`theme-${option.value}`} />
              <option.icon className="h-4 w-4 text-muted-foreground" />
              {option.label}
            </label>
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  )
}
