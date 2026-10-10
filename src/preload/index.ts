import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { Settings, RunRequest, AgentEvent } from '@shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (s: Settings): Promise<Settings> => ipcRenderer.invoke(IPC.setSettings, s),
  pickWorkdir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickWorkdir),
  listOllamaModels: (s: Settings): Promise<string[]> => ipcRenderer.invoke(IPC.listOllamaModels, s),
  runAgent: (req: RunRequest): Promise<void> => ipcRenderer.invoke(IPC.runAgent, req),
  cancelAgent: (): Promise<void> => ipcRenderer.invoke(IPC.cancelAgent),
  onAgentEvent: (cb: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AgentEvent): void => cb(event)
    ipcRenderer.on(IPC.agentEvent, listener)
    return () => ipcRenderer.removeListener(IPC.agentEvent, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
