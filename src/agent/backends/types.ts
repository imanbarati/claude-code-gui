import type { AgentEvent, Settings, ToolResult, ToolCall, ToolPreview } from '@shared/types'
import { runTool, previewTool, isMutatingTool, type ToolContext } from '../tools'

// Run a list of tool calls, applying the approval gate to mutating tools.
// Emits tool_call / tool_result events and returns the results for the loop.
export async function runToolsWithApproval(
  ctx: ToolContext,
  calls: ToolCall[],
  autoApprove: boolean,
  onEvent: (e: AgentEvent) => void,
  requestApproval?: (call: ToolCall, preview: ToolPreview) => Promise<boolean>
): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  for (const call of calls) {
    onEvent({ type: 'tool_call', call })

    if (isMutatingTool(call.name) && !autoApprove) {
      const preview = previewTool(ctx, call)
      const approved = requestApproval ? await requestApproval(call, preview) : true
      if (!approved) {
        const denied: ToolResult = {
          id: call.id,
          name: call.name,
          ok: false,
          output: 'Denied by user. Do not retry this action unless the user changes their mind.'
        }
        onEvent({ type: 'tool_result', result: denied })
        results.push(denied)
        continue
      }
    }

    const result = await runTool(ctx, call)
    onEvent({ type: 'tool_result', result })
    results.push(result)
  }
  return results
}
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
  // Called before a mutating tool runs. Resolves true to allow, false to deny.
  requestApproval?: (call: ToolCall, preview: ToolPreview) => Promise<boolean>
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
