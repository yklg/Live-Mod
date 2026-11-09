export type MainEvents = {
  'page-closed': {
    accountId: string
  }
  'providers-updated': Record<string, ProviderInfo>
  'live-session-started': {
    accountId: string
    platform: string
    startedAt: number
  }
  'live-session-ended': {
    accountId: string
    endedAt: number
    reason: 'disconnect' | 'live-ended'
  }
  'live-history-updated': {
    sessions: Array<{
      id: string
      accountId: string
      platform: string
      startedAt: number
      endedAt: number | null
      status: 'live' | 'ended' | 'interrupted'
    }>
  }
}
