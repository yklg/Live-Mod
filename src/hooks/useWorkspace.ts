import { useEffect } from 'react'
import { DEFAULT_WORKSPACE_STATE, type WorkspaceState } from 'shared/accounts'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'

interface WorkspaceStore extends WorkspaceState {
  hydrated: boolean
}

const store = create<WorkspaceStore>(() => ({ ...DEFAULT_WORKSPACE_STATE, hydrated: false }))
let hydration: Promise<void> | null = null
let listened = false

function ensureHydrated() {
  if (hydration) return hydration
  hydration = (async () => {
    if (!listened) {
      listened = true
      window.ipcRenderer.on(IPC_CHANNELS.shell.workspaceState, (state: WorkspaceState) => {
        store.setState({ ...state, hydrated: true })
      })
    }
    const state = await window.ipcRenderer.invoke(IPC_CHANNELS.shell.workspaceSnapshot)
    store.setState({ ...state, hydrated: true })
  })().catch(() => {
    store.setState({ hydrated: false })
  })
  return hydration
}

export function useWorkspaceState<T>(selector: (state: WorkspaceStore) => T): T {
  useEffect(() => {
    void ensureHydrated()
  }, [])
  return store(selector)
}
