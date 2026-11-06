import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  findCatalogEntry,
  isEntryPlatformSupported,
  SHELL_PLATFORM_CATALOG,
} from '#/platforms/catalog'

// ===== 平台目录唯一真源契约（shell-entry-platform-selector v1 · Verification 0）=====
// I-C1 目录 = 抖音系三平台，顺序 douyin → buyin → eos（顺序即选择器展示顺序）；
// I-C2 元数据完整且唯一（label 唯一、id 合法、attachSupported 与壳内白名单一致）；
// I-C3 图标标识可解析到本地资产（禁止热链远端，构建随包 / 离线可用）；
// I-C4 真源不可变（冻结数组 + 条目，防跨模块原地改）。

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('SHELL_PLATFORM_CATALOG 目录契约（TC-C1~C4）', () => {
  it('TC-C1 [顺序] douyin(抖店) → buyin(巨量百应) → eos(抖音团购)', () => {
    expect(SHELL_PLATFORM_CATALOG.map(entry => entry.id)).toEqual(['douyin', 'buyin', 'eos'])
    expect(SHELL_PLATFORM_CATALOG.map(entry => entry.label)).toEqual([
      '抖店',
      '巨量百应',
      '抖音团购',
    ])
  })

  it('TC-C2 [元数据] 逐字段与计划定档一致（无多余字段）', () => {
    expect(SHELL_PLATFORM_CATALOG).toEqual([
      {
        id: 'douyin',
        label: '抖店',
        description: '抖音电商 · 抖音小店直播中控台',
        category: 'douyin',
        attachSupported: true,
        icon: 'douyin',
      },
      {
        id: 'buyin',
        label: '巨量百应',
        description: '抖音精选联盟 · 百应直播中控台',
        category: 'douyin',
        attachSupported: true,
        icon: 'buyin',
      },
      {
        id: 'eos',
        label: '抖音团购',
        description: '抖音本地生活 · 团购直播中控台',
        category: 'douyin',
        attachSupported: true,
        icon: 'eos',
      },
    ])
  })

  it('TC-C3 [唯一性] id / label / icon 三者各自不重复', () => {
    const ids = SHELL_PLATFORM_CATALOG.map(entry => entry.id)
    const labels = SHELL_PLATFORM_CATALOG.map(entry => entry.label)
    const icons = SHELL_PLATFORM_CATALOG.map(entry => entry.icon)
    expect(new Set(ids).size).toBe(SHELL_PLATFORM_CATALOG.length)
    expect(new Set(labels).size).toBe(SHELL_PLATFORM_CATALOG.length)
    expect(new Set(icons).size).toBe(SHELL_PLATFORM_CATALOG.length)
  })

  it('TC-C4 [能力/枚举] id 均在 LiveControlPlatform 联合内，且一期全部 attachSupported', () => {
    const legalPlatforms: LiveControlPlatform[] = [
      'douyin',
      'buyin',
      'eos',
      'xiaohongshu',
      'pgy',
      'wxchannel',
      'kuaishou',
      'taobao',
      'dev',
    ]
    for (const entry of SHELL_PLATFORM_CATALOG) {
      expect(legalPlatforms).toContain(entry.id)
      expect(entry.category).toBe('douyin')
      expect(entry.attachSupported).toBe(true)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('TC-C5 [资产] 每个 icon 都解析到 public/platform-icons/{icon}.png 且为合法 PNG', () => {
    for (const entry of SHELL_PLATFORM_CATALOG) {
      const iconPath = path.join(root, 'public/platform-icons', `${entry.icon}.png`)
      expect(fs.existsSync(iconPath), `缺少平台图标资产：${iconPath}`).toBe(true)
      const head = fs.readFileSync(iconPath).subarray(0, 8)
      // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  })

  it('TC-C6 [不可变] 数组与条目均冻结（唯一真源防误改）', () => {
    expect(Object.isFrozen(SHELL_PLATFORM_CATALOG)).toBe(true)
    for (const entry of SHELL_PLATFORM_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true)
    }
  })
})

describe('目录查询函数（TC-C7~C9）', () => {
  it('TC-C7 [findCatalogEntry] 命中返回目录内同一引用，未收录/大小写不符 → null', () => {
    SHELL_PLATFORM_CATALOG.forEach((entry, index) => {
      expect(findCatalogEntry(entry.id)).toBe(SHELL_PLATFORM_CATALOG[index])
    })
    expect(findCatalogEntry('kuaishou')).toBeNull()
    expect(findCatalogEntry('Douyin')).toBeNull()
    expect(findCatalogEntry('')).toBeNull()
    expect(findCatalogEntry('__proto__')).toBeNull()
  })

  it('TC-C8 [isEntryPlatformSupported] 目录三平台 true，其余枚举与脏输入 false', () => {
    for (const platform of ['douyin', 'buyin', 'eos']) {
      expect(isEntryPlatformSupported(platform)).toBe(true)
    }
    for (const platform of [
      'kuaishou',
      'taobao',
      'wxchannel',
      'xiaohongshu',
      'pgy',
      'dev',
      '',
      '任意',
    ]) {
      expect(isEntryPlatformSupported(platform)).toBe(false)
    }
  })
})
