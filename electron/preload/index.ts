import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { ElectronAPI, IpcChannels } from 'shared/electron-api'

type IpcRendererInvokeReturnType<Channel extends keyof IpcChannels> =
  ReturnType<IpcChannels[Channel]> extends Promise<infer _U>
    ? ReturnType<IpcChannels[Channel]>
    : Promise<ReturnType<IpcChannels[Channel]>>

const ipcRendererApi: ElectronAPI['ipcRenderer'] = {
  on<Channel extends keyof IpcChannels>(
    channel: Channel,
    listener: (...args: Parameters<IpcChannels[Channel]>) => void,
  ): () => void {
    const subscription = (_event: IpcRendererEvent, ...args: Parameters<IpcChannels[Channel]>) =>
      listener(...args)

    ipcRenderer.on(channel as string, subscription)
    return () => {
      ipcRenderer.off(channel as string, subscription)
    }
  },

  send: <Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): void => {
    ipcRenderer.send(channel as string, ...args) // <--- 也在这里加上断言
  },

  invoke: <Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): IpcRendererInvokeReturnType<Channel> => {
    return ipcRenderer.invoke(channel as string, ...args) as IpcRendererInvokeReturnType<Channel>
  },
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', ipcRendererApi)
