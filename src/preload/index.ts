import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { Settings, RunRequest, AgentEvent, Conversation, ApprovalDecision } from '@shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (s: Settings): Promise<Settings> => ipcRenderer.invoke(IPC.setSettings, s),
  pickWorkdir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickWorkdir),
  listOllamaModels: (s: Settings): Promise<string[]> => ipcRenderer.invoke(IPC.listOllamaModels, s),
  runAgent: (req: RunRequest): Promise<void> => ipcRenderer.invoke(IPC.runAgent, req),
  cancelAgent: (): Promise<void> => ipcRenderer.invoke(IPC.cancelAgent),
  approveTool: (decision: ApprovalDecision): Promise<void> => ipcRenderer.invoke(IPC.approveTool, decision),
  getConversation: (): Promise<Conversation> => ipcRenderer.invoke(IPC.getConversation),
  setConversation: (c: Conversation): Promise<Conversation> => ipcRenderer.invoke(IPC.setConversation, c),
  clearConversation: (): Promise<void> => ipcRenderer.invoke(IPC.clearConversation),
  exportChat: (): Promise<string | null> => ipcRenderer.invoke(IPC.exportChat),
  previewMentions: (prompt: string, workdir: string): Promise<Array<{ path: string; exists: boolean }>> =>
    ipcRenderer.invoke('agent:previewMentions', prompt, workdir),
  onAgentEvent: (cb: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AgentEvent): void => cb(event)
    ipcRenderer.on(IPC.agentEvent, listener)
    return () => ipcRenderer.removeListener(IPC.agentEvent, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
