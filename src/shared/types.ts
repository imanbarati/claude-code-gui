// Types shared between main, preload and renderer.

export type BackendId = 'claude-code' | 'ollama' | 'openrouter'

export interface Settings {
  backend: BackendId
  // Claude Code CLI
  claudeModel: string
  claudeCommand: string
  // Ollama (free / local)
  ollamaUrl: string
  ollamaModel: string
  // OpenRouter (free tier)
  openRouterKey: string
  openRouterModel: string
  // Common
  workdir: string
  autoApproveTools: boolean
  maxSteps: number
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'claude-code',
  claudeModel: 'claude-3-5-sonnet-latest',
  claudeCommand: 'claude',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  openRouterKey: '',
  openRouterModel: 'qwen/qwen3-coder:free',
  workdir: '',
  autoApproveTools: false,
  maxSteps: 12
}

// A chat message in the UI.
export type Role = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  createdAt: number
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  ok: boolean
  output: string
}

// Events streamed from main -> renderer during a run.
export type AgentEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'step'; step: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface RunRequest {
  prompt: string
  settings: Settings
}

// IPC channel names.
export const IPC = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickWorkdir: 'dialog:pickWorkdir',
  runAgent: 'agent:run',
  cancelAgent: 'agent:cancel',
  agentEvent: 'agent:event',
  listOllamaModels: 'ollama:list'
} as const
