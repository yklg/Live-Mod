/** 用内嵌 Chromium 版本拼标准 Chrome UA，剥离 Electron/LiveMod 标识（PoC-1 实测 0% headless 的关键） */
export function chromeUa(): string {
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
}
