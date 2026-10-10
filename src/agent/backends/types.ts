import type { AgentEvent, Settings, ToolResult } from '@shared/types'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolResults?: ToolResult[]
}

export interface BackendRunArgs {
  settings: Settings
  history: ChatTurn[]
  prompt: string
  onEvent: (event: AgentEvent) => void
  signal: AbortSignal
}

export interface Backend {
  id: string
  run(args: BackendRunArgs): Promise<void>
  // Optional: list models for the settings UI.
  listModels?(settings: Settings): Promise<string[]>
}

export function systemPrompt(settings: Settings): string {
  return [
    'You are an autonomous coding agent running inside a desktop app on Windows.',
    `The user's project is rooted at: ${settings.workdir || '(not set)'}`,
    '',
    'You have tools to read_file, write_file, list_dir and run_command.',
    'Rules:',
    '- Prefer reading files before changing them.',
    '- Make the smallest change that satisfies the request.',
    '- After editing, verify by running relevant build/test commands when useful.',
    '- Use paths RELATIVE to the project root.',
    '- When you have finished, reply with a concise summary of what you did.'
  ].join('\n')
}
