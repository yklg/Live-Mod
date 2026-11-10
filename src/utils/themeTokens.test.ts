import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`missing ${selector} block`)
  return match[1]
}

function keys(source: string) {
  return new Set([...source.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]))
}

const root = block(':root')
const dark = block('.dark')
const rootKeys = keys(root)
const darkKeys = keys(dark)

const paired = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'surface-1',
  'surface-2',
  'surface-3',
  'border-hairline',
  'elevation-1',
  'elevation-2',
  'elevation-float',
]

const themeOnly = [
  'motion-fast',
  'motion-base',
  'motion-slow',
  'ease-standard',
  'text-body',
  'text-body-line',
  'text-secondary',
  'text-secondary-line',
  'text-micro',
  'text-micro-line',
  'lm-radius-control',
  'lm-radius-card',
  'lm-radius-float',
]

describe('theme tokens', () => {
  it('keeps light/dark semantic keys paired', () => {
    for (const key of paired) {
      expect(rootKeys.has(key), `:root missing --${key}`).toBe(true)
      expect(darkKeys.has(key), `.dark missing --${key}`).toBe(true)
    }
  })

  it('keeps motion and typography tokens available in the root scope', () => {
    for (const key of themeOnly) {
      expect(rootKeys.has(key), `:root missing --${key}`).toBe(true)
    }
  })

  it('does not redefine raw palette tokens in dark mode', () => {
    for (const key of darkKeys) {
      expect(key.startsWith('lm-'), `.dark redefines raw token --${key}`).toBe(false)
    }
  })

  it('exposes the new semantic tokens through the Tailwind theme layer', () => {
    const theme = block('@theme inline')
    const themeKeys = keys(theme)
    for (const key of [
      'color-surface-1',
      'color-surface-2',
      'color-surface-3',
      'color-border-hairline',
      'shadow-elevation-1',
      'shadow-elevation-2',
      'shadow-float',
      'radius-xs',
      'radius-control',
      'radius-card',
      'radius-float',
      'text-sm',
    ]) {
      expect(themeKeys.has(key), `@theme inline missing --${key}`).toBe(true)
    }
  })
})
