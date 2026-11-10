import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { cn } from '@/lib/utils'

export interface SettingsSection {
  id: string
  label: string
  content: ReactNode
}

/**
 * 长设置页共享骨架：左侧粘性锚点目录 + 右侧分区滚动内容。
 * 分区内容自带卡片（由调用方提供），本组件只负责导航与定位。
 */
export function SettingsLayout({
  sections,
  className,
}: {
  sections: SettingsSection[]
  className?: string
}) {
  const location = useLocation()

  // HashRouter 无法自动处理锚点定位，这里监听 hash 变化手动滚动
  useEffect(() => {
    if (!location.hash) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [location.hash])

  const handleNavClick = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div
      data-testid="settings-layout"
      className={cn(
        'grid grid-cols-[148px_1fr] items-start gap-4',
        '@max-[560px]/panel:grid-cols-1 @max-[560px]/panel:gap-3',
        className,
      )}
    >
      <nav
        aria-label="设置目录"
        className="sticky top-0 flex flex-col gap-1 @max-[560px]/panel:static @max-[560px]/panel:flex-row @max-[560px]/panel:flex-wrap"
      >
        {sections.map(section => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={handleNavClick(section.id)}
            className="rounded-control border-l-2 border-transparent px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {section.label}
          </a>
        ))}
      </nav>
      <div className="min-w-0 space-y-3">
        {sections.map(section => (
          <section key={section.id} id={section.id} className="scroll-mt-4">
            {section.content}
          </section>
        ))}
      </div>
    </div>
  )
}
