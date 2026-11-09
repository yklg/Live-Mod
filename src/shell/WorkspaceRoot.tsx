import { House, Monitor, Plus, Settings, Sparkles } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useAccounts } from '@/hooks/useAccounts'
import { useLiveHistory } from '@/hooks/useLiveHistory'
import { useWorkspaceState } from '@/hooks/useWorkspace'
import './workspace.css'

function formatDuration(startedAt: number, endedAt: number | null) {
  const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt)
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initial(name: string) {
  return name.trim().slice(0, 1) || '账'
}

export function WorkspaceRoot() {
  const mode = useWorkspaceState(s => s.mode)
  const { accounts, currentAccountId, hydrated, switchAccount } = useAccounts()
  const sessions = useLiveHistory(s => s.sessions)
  const [platforms, setPlatforms] = useState<ShellPlatformEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.ipcRenderer
      .invoke(IPC_CHANNELS.shell.entryCatalog)
      .then((catalog: ShellEntryCatalog) => setPlatforms(catalog.platforms))
      .catch(() => setPlatforms([]))
  }, [])

  const current = accounts.find(a => a.id === currentAccountId) ?? accounts[0]
  const currentName = current?.name ?? '未选择账号'
  const liveSessions = sessions.filter(s => s.status === 'live')
  const latest = sessions[0]
  const connectedIds = useMemo(() => new Set(liveSessions.map(s => s.accountId)), [liveSessions])

  const openLive = () => {
    if (connectedIds.size === 0 && sessions.length === 0) {
      setError('请先从平台工作台进入中控台')
      return
    }
    setError(null)
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.workspaceModeSet, 'live')
  }
  const openPanel = (route: string) =>
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.workspaceOpenPanel, route)
  const goWorkbench = () =>
    void window.ipcRenderer.invoke(IPC_CHANNELS.shell.workspaceModeSet, 'workbench')
  const toggleAssistant = () => void window.ipcRenderer.invoke(IPC_CHANNELS.shell.assistantToggle)

  const selectPlatform = async (id: LiveControlPlatform) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result: { ok: boolean; reason?: string } = await window.ipcRenderer.invoke(
        IPC_CHANNELS.shell.entrySelect,
        { platform: id, remember: true },
      )
      if (!result.ok) setError(`暂时无法进入该平台（${result.reason ?? 'unknown'}）`)
    } catch {
      setError('进入平台失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const selectAccount = async (id: string) => {
    setError(null)
    const ok = await switchAccount(id)
    if (!ok) setError('切换账号失败')
  }

  if (mode !== 'workbench') {
    return (
      <div className="ws-root ws-compact" data-testid="workspace-compact">
        <button type="button" className="ws-compact-btn" title="工作台" onClick={goWorkbench}>
          <House className="size-4" />
        </button>
        <div className="ws-compact-divider" />
        {accounts.slice(0, 4).map(account => (
          <button
            type="button"
            key={account.id}
            className={`ws-compact-avatar ${account.id === currentAccountId ? 'active' : ''}`}
            title={account.name}
            onClick={() => void selectAccount(account.id)}
          >
            {initial(account.name)}
            {connectedIds.has(account.id) && <i className="ws-live-dot" />}
          </button>
        ))}
        <button
          type="button"
          className="ws-compact-btn"
          title="账号/设置"
          onClick={() => openPanel('settings')}
        >
          <Plus className="size-4" />
        </button>
        <div className="ws-compact-spacer" />
        <button type="button" className="ws-compact-btn" title="AI 助手" onClick={toggleAssistant}>
          <Sparkles className="size-4" />
        </button>
        <button
          type="button"
          className="ws-compact-btn"
          title="设置"
          onClick={() => openPanel('settings')}
        >
          <Settings className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="ws-root ws-home" data-testid="workspace-home">
      <aside className="ws-side">
        <div className="ws-side-head">
          <span>账号</span>
          <button
            type="button"
            className="ws-mini-btn"
            title="账号/设置"
            onClick={() => openPanel('settings')}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="ws-account-list">
          {!hydrated && <div className="ws-muted ws-pad">账号加载中…</div>}
          {accounts.map(account => (
            <button
              type="button"
              key={account.id}
              className={`ws-account ${account.id === currentAccountId ? 'active' : ''}`}
              onClick={() => void selectAccount(account.id)}
            >
              <span className="ws-avatar">{initial(account.name)}</span>
              <span className="ws-account-info">
                <b>{account.name}</b>
                <em>{connectedIds.has(account.id) ? '已连接中控台' : '未连接'}</em>
              </span>
              {connectedIds.has(account.id) && <span className="ws-live-pill">直播中</span>}
            </button>
          ))}
        </div>
        <div className="ws-side-head ws-side-head-gap">
          <span>最近场次</span>
          <span className="ws-muted">{sessions.length}</span>
        </div>
        <div className="ws-recent-list">
          {sessions.slice(0, 3).map(session => (
            <button
              type="button"
              key={session.id}
              className="ws-recent"
              onClick={() => {
                void selectAccount(session.accountId)
                openLive()
              }}
            >
              <i className={`ws-recent-dot ${session.status === 'live' ? 'live' : ''}`} />
              <span>
                <b>{session.platform}</b>
                <em>
                  {formatTime(session.startedAt)} ·{' '}
                  {formatDuration(session.startedAt, session.endedAt)}
                </em>
              </span>
            </button>
          ))}
          {sessions.length === 0 && <div className="ws-muted ws-pad">还没有场次记录</div>}
        </div>
        <div className="ws-side-foot">
          <button type="button" className="ws-side-foot-btn" onClick={() => openPanel('settings')}>
            <Settings className="size-3.5" /> 设置
          </button>
        </div>
      </aside>

      <main className="ws-main">
        <header className="ws-head">
          <div>
            <h1>下午好，{currentName}</h1>
            <p>
              {liveSessions.length > 0
                ? `有 ${liveSessions.length} 场直播正在进行`
                : '选择平台开始一场直播，或继续上次场次'}
            </p>
          </div>
          <div className="ws-head-actions">
            <button type="button" className="ws-btn ghost" onClick={() => openPanel('settings')}>
              账号设置
            </button>
            <button type="button" className="ws-btn primary" onClick={openLive}>
              <Monitor className="size-3.5" /> 打开中控台
            </button>
          </div>
        </header>

        {error && <div className="ws-error">{error}</div>}

        {latest ? (
          <section className="ws-hero">
            <div className="ws-hero-thumb">
              <span className="ws-live-badge">LIVE</span>
              <span className="ws-hero-time">{formatTime(latest.startedAt)}</span>
            </div>
            <div className="ws-hero-info">
              <span className="ws-kicker">{latest.platform}</span>
              <h2>{latest.status === 'live' ? '正在直播' : '上次直播'}</h2>
              <p>
                开始 {formatTime(latest.startedAt)} · 时长{' '}
                {formatDuration(latest.startedAt, latest.endedAt)}
              </p>
              <div className="ws-hero-actions">
                <button type="button" className="ws-btn primary" onClick={openLive}>
                  回到中控台
                </button>
                <button
                  type="button"
                  className="ws-btn ghost"
                  onClick={() => openPanel('interaction')}
                >
                  直播互动
                </button>
              </div>
            </div>
            <div className="ws-hero-metrics">
              <div>
                <em>状态</em>
                <b>
                  {latest.status === 'live'
                    ? '直播中'
                    : latest.status === 'ended'
                      ? '已结束'
                      : '异常结束'}
                </b>
              </div>
              <div>
                <em>账号</em>
                <b>{accounts.find(a => a.id === latest.accountId)?.name ?? latest.accountId}</b>
              </div>
            </div>
          </section>
        ) : (
          <section className="ws-empty-hero">
            <Monitor className="size-5" />
            <div>
              <b>还没有直播场次</b>
              <p>从下面的平台工作台进入中控台，连接后会自动记录场次。</p>
            </div>
          </section>
        )}

        <div className="ws-section-head">
          <h2>平台工作台</h2>
          <span>{platforms.length} 个入口</span>
        </div>
        <div className="ws-platform-grid" data-testid="platform-grid">
          {platforms.map(platform => (
            <button
              type="button"
              key={platform.id}
              className="ws-platform"
              disabled={busy}
              onClick={() => void selectPlatform(platform.id)}
            >
              <span className="ws-platform-top">
                <span className="ws-platform-icon">{platform.label.slice(0, 1)}</span>
                <span className="ws-platform-arrow">↗</span>
              </span>
              <b>{platform.label}</b>
              <em>{platform.description}</em>
            </button>
          ))}
          {platforms.length === 0 && <div className="ws-muted">平台目录加载中…</div>}
        </div>

        <div className="ws-section-head">
          <h2>最近场次</h2>
          <span>{sessions.length} 条</span>
        </div>
        <div className="ws-session-table" data-testid="session-table">
          <div className="ws-session-row head">
            <span>平台</span>
            <span>开始</span>
            <span>时长</span>
            <span>状态</span>
          </div>
          {sessions.slice(0, 6).map(session => (
            <div className="ws-session-row" key={session.id}>
              <span>{session.platform}</span>
              <span>{formatTime(session.startedAt)}</span>
              <span>{formatDuration(session.startedAt, session.endedAt)}</span>
              <span>
                <em className={`ws-status ${session.status}`}>
                  {session.status === 'live'
                    ? '直播中'
                    : session.status === 'ended'
                      ? '已结束'
                      : '异常结束'}
                </em>
              </span>
            </div>
          ))}
          {sessions.length === 0 && <div className="ws-muted ws-pad">暂无场次</div>}
        </div>
      </main>
    </div>
  )
}
