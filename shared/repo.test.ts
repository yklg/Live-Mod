import { describe, expect, it } from 'vitest'
import { parseGithubRepo } from './repo'

describe('parseGithubRepo', () => {
  it('解析 git+https 地址', () => {
    expect(parseGithubRepo({ url: 'git+https://github.com/foo/live-mod.git' })).toEqual({
      owner: 'foo',
      repo: 'live-mod',
    })
  })

  it('解析 https 地址（无 .git 后缀）', () => {
    expect(parseGithubRepo({ url: 'https://github.com/foo/live-mod' })).toEqual({
      owner: 'foo',
      repo: 'live-mod',
    })
  })

  it('解析 ssh 地址', () => {
    expect(parseGithubRepo({ url: 'git@github.com:foo/live-mod.git' })).toEqual({
      owner: 'foo',
      repo: 'live-mod',
    })
  })

  it('支持字符串简写形式', () => {
    expect(parseGithubRepo('https://github.com/foo/live-mod.git')).toEqual({
      owner: 'foo',
      repo: 'live-mod',
    })
  })

  it('空 url 返回 null（未配置更新源）', () => {
    expect(parseGithubRepo({ url: '' })).toBeNull()
  })

  it('未配置 repository 返回 null', () => {
    expect(parseGithubRepo(undefined)).toBeNull()
  })

  it('非 GitHub 地址返回 null', () => {
    expect(parseGithubRepo({ url: 'https://gitlab.com/foo/bar.git' })).toBeNull()
  })

  it('仓库名大小写保持原样', () => {
    expect(parseGithubRepo({ url: 'git+https://github.com/Foo/Live-Mod.git' })).toEqual({
      owner: 'Foo',
      repo: 'Live-Mod',
    })
  })
})
