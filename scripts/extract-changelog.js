// 提取 CHANGELOG 中当前 package.json 版本对应的 release notes。
// 用法：
//   node scripts/extract-changelog.js            → stdout（本地预览/调试）
//   node scripts/extract-changelog.js <outfile>  → 写入文件（CI 用；跨平台，不依赖 shell heredoc）
//
// 背景：旧 workflow 在 Windows runner（默认 pwsh）用 bash heredoc + $GITHUB_OUTPUT 写多行 output，
// 导致 release body 为空；改为 node 直接写文件、action 用 body_path，Windows/macOS 行为一致。
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '../package.json')

const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
const version = pkg.version

const changelogPath = resolve(__dirname, '../CHANGELOG.md')
const content = await readFile(changelogPath, 'utf-8')

const currentVersion = `v${version}`
const escapedVersion = currentVersion.replace(/\./g, '\\.')

// 匹配当前版本标题（到下一个版本标题前）
const regex = new RegExp(`##\\s+${escapedVersion}(.*?)##\\s+v`, 's')
const fallbackRegex = new RegExp(`##\\s+${escapedVersion}(.*)`, 's')
const notes = (content.match(regex)?.[1] ?? content.match(fallbackRegex)?.[1] ?? '').trim()

const text = notes || `No changelog found for this version (${currentVersion}).`
const outFile = process.argv[2]
if (outFile) {
  await writeFile(outFile, `${text}\n`, 'utf-8')
  console.log(`[extract-changelog] wrote ${outFile} (${text.length} chars)`)
} else {
  console.log(text)
}
