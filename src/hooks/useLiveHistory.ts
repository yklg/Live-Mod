import { useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { LiveHistorySnapshot, LiveSession } from 'shared/liveHistory'
import { create } from 'zustand'

interface LiveHistoryStore {
  sessions: LiveSession[]
  hydrated: boolean
}

const store = create<LiveHistoryStore>(() => ({ sessions: [], hydrated: false }))
let hydration: Promise<void> | null = null
let listened = false

function ensureHydrated() {
  if (hydration) return hydration
  hydration = (async () => {
    if (!listened) {
      listened = true
      window.ipcRenderer.on(
        IPC_CHANNELS.workspace.historyUpdated,
        (snapshot: LiveHistorySnapshot) => {
          store.setState({ sessions: snapshot.sessions, hydrated: true })
        },
      )
    }
    const snapshot = await window.ipcRenderer.invoke(IPC_CHANNELS.workspace.history)
    store.setState({ sessions: snapshot.sessions, hydrated: true })
  })().catch(() => {
    store.setState({ hydrated: false })
  })
  return hydration
}

export function useLiveHistory<T>(selector: (state: LiveHistoryStore) => T): T {
  useEffect(() => {
    void ensureHydrated()
  }, [])
  return store(selector)
}
