import type { Backend, BackendRunArgs } from './types'
import { systemPrompt, runToolsWithApproval } from './types'
import { TOOL_SPECS, type ToolContext } from '../tools'
import type { ToolCall } from '@shared/types'

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface OpenRouterMessage {
  role: string
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export class OpenRouterBackend implements Backend {
  id = 'openrouter'
  private url = 'https://openrouter.ai/api/v1/chat/completions'

  async listModels(): Promise<string[]> {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`)
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id).filter((id) => id.includes(':free'))
  }

  async run(args: BackendRunArgs): Promise<void> {
    const { settings, history, prompt, onEvent, signal, requestApproval } = args
    const ctx: ToolContext = { workdir: settings.workdir || process.cwd() }

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt(settings) },
      ...history
        .filter((h) => h.role !== 'tool')
        .map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: prompt }
    ]

    const tools = TOOL_SPECS.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))

    for (let step = 0; step < settings.maxSteps; step++) {
      if (signal.aborted) return
      onEvent({ type: 'step', step })

      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openRouterKey}`,
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Claude Code GUI'
        },
        signal,
        body: JSON.stringify({
          model: settings.openRouterModel,
          messages,
          tools,
          tool_choice: 'auto'
        })
      })
      if (!res.ok) {
        onEvent({ type: 'error', message: `OpenRouter failed: ${res.status} ${await res.text()}` })
        return
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: OpenRouterMessage }>
      }
      const msg = data.choices?.[0]?.message
      if (!msg) {
        onEvent({ type: 'error', message: 'OpenRouter returned no message.' })
        return
      }

      const toolCalls = (msg.tool_calls ?? []).map((tc): ToolCall => {
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(tc.function.arguments || '{}')
        } catch {
          parsed = {}
        }
        return { id: tc.id || makeId('call'), name: tc.function.name, args: parsed }
      })

      if (toolCalls.length === 0) {
        onEvent({
          type: 'assistant_message',
          message: {
            id: makeId('msg'),
            role: 'assistant',
            content: msg.content ?? '',
            createdAt: Date.now()
          }
        })
        onEvent({ type: 'done' })
        return
      }

      const results = await runToolsWithApproval(
        ctx,
        toolCalls,
        settings.autoApproveTools,
        onEvent,
        requestApproval
      )

      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      for (const r of results) {
        messages.push({ role: 'tool', content: r.output, tool_call_id: r.id })
      }
    }
    onEvent({ type: 'error', message: `Stopped after ${settings.maxSteps} steps (max reached).` })
  }
}
