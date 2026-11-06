// 壳入口平台目录唯一真源（shell-entry-platform-selector v1 · Proposed Changes 1）——零 Electron import。
// 边界（架构不变量）：
//   - 只承载「入口选择器展示所需」的平台元数据（id / label / description / category / 能力 / 图标标识）；
//   - 目标 URL、选择器、注入脚本等运行细节仍归各平台 constant.ts，本目录不复制（防第二真源）；
//   - renderer 不写死平台列表：经 shell:entryCatalog 读取本目录（OCP：新增平台 = 加一条 + 白名单一项）。
// 图标标识与 public/platform-icons/{icon}.png 同源：换官方高清资源只替换同名文件，本目录与代码零改动。

/** 目录条目构造：静态冻结核对（真源被跨模块误改时在测试期立刻暴露，而非运行期漂移） */
const CATALOG_ENTRIES: readonly ShellPlatformEntry[] = [
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
]

/**
 * 入口可展示平台的有序清单（顺序即选择器展示顺序：抖店 → 巨量百应 → 抖音团购）。
 * readonly + 冻结：目录是唯一真源，任何层都不得原地排序/增删。
 */
export const SHELL_PLATFORM_CATALOG: readonly ShellPlatformEntry[] = Object.freeze(
  CATALOG_ENTRIES.map(entry => Object.freeze(entry)),
)

/** 目录查询：命中返回目录内同一引用（UI 直接展示，不复制），未收录返回 null */
export function findCatalogEntry(platform: string): ShellPlatformEntry | null {
  return SHELL_PLATFORM_CATALOG.find(entry => entry.id === platform) ?? null
}

/**
 * 是否可作为壳入口平台被选择：
 * 收录于目录 **且** 具备壳内 attach 能力（attachSupported=false 的条目仅展示/预留，不可连接）。
 * 与 findCatalogEntry 的职责分离，是入口选择裁决「unknown vs unsupported」的判据。
 */
export function isEntryPlatformSupported(platform: string): boolean {
  return findCatalogEntry(platform)?.attachSupported === true
}
