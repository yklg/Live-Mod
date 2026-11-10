import { useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { DEFAULT_SHELL_CHROME_STATE, type ShellChromeState } from 'shared/shellState'
import { create } from 'zustand'

interface ShellModeStore extends ShellChromeState {
  hydrated: boolean
}

const store = create<ShellModeStore>(() => ({ ...DEFAULT_SHELL_CHROME_STATE, hydrated: false }))
let hydration: Promise<void> | null = null
let listened = false

function ensureHydrated() {
  if (hydration) return hydration
  hydration = (async () => {
    if (!listened) {
      listened = true
      window.ipcRenderer.on(IPC_CHANNELS.shell.modeState, (state: ShellChromeState) => {
        store.setState({ ...state, hydrated: true })
      })
    }
    const state = await window.ipcRenderer.invoke(IPC_CHANNELS.shell.modeSnapshot)
    store.setState({ ...state, hydrated: true })
  })().catch(() => {
    store.setState({ hydrated: false })
  })
  return hydration
}

export function useShellMode<T>(selector: (state: ShellModeStore) => T): T {
  useEffect(() => {
    void ensureHydrated()
  }, [])
  return store(selector)
}
