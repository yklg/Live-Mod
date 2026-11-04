/**
 * GitHub 仓库信息，解析自 package.json 的 repository 字段。
 * 供更新检查（UpdateManager）等需要仓库地址的模块共用。
 */
export interface GithubRepo {
  owner: string
  repo: string
}

/**
 * 从 package.json 的 repository 字段解析 GitHub 仓库信息。
 * 支持以下格式：
 *   - git+https://github.com/<owner>/<repo>.git
 *   - https://github.com/<owner>/<repo>.git（.git 后缀可省略）
 *   - git@github.com:<owner>/<repo>.git
 *   - 字符串简写形式（npm 规范允许 repository 直接为字符串）
 * 返回 null 表示未配置或无法解析，调用方应禁用更新检查。
 */
export function parseGithubRepo(
  repository: { url?: string } | string | undefined,
): GithubRepo | null {
  const url = typeof repository === 'string' ? repository : repository?.url
  if (!url) return null
  const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)
  return match ? { owner: match[1], repo: match[2] } : null
}
