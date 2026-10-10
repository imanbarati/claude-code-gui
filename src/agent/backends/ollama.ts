import type { Backend, BackendRunArgs } from './types'
import { systemPrompt, runToolsWithApproval } from './types'
import { TOOL_SPECS, type ToolContext } from '../tools'
import type { ToolCall } from '@shared/types'

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface OllamaMessage {
  role: string
  content: string
  tool_calls?: Array<{ function: { name: string; arguments: any } }>
}

export class OllamaBackend implements Backend {
  id = 'ollama'

  async listModels(settings: import('@shared/types').Settings): Promise<string[]> {
    const res = await fetch(`${settings.ollamaUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`)
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    return (data.models ?? []).map((m) => m.name)
  }

  async run(args: BackendRunArgs): Promise<void> {
    const { settings, history, prompt, onEvent, signal, requestApproval } = args
    const ctx: ToolContext = { workdir: settings.workdir || process.cwd() }

    const messages: OllamaMessage[] = [
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

      const res = await fetch(`${settings.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: settings.ollamaModel,
          messages,
          tools,
          stream: false
        })
      })
      if (!res.ok) {
        onEvent({ type: 'error', message: `Ollama chat failed: ${res.status} ${await res.text()}` })
        return
      }
      const data = (await res.json()) as { message?: OllamaMessage }
      const msg = data.message
      if (!msg) {
        onEvent({ type: 'error', message: 'Ollama returned no message.' })
        return
      }

      const toolCalls = (msg.tool_calls ?? []).map((tc): ToolCall => ({
        id: makeId('call'),
        name: tc.function.name,
        args: typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : (tc.function.arguments ?? {})
      }))

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

      // Announce calls, run them (with approval gate), feed results back.
      const results = await runToolsWithApproval(
        ctx,
        toolCalls,
        settings.autoApproveTools,
        onEvent,
        requestApproval
      )

      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      for (const r of results) {
        messages.push({ role: 'tool', content: r.output })
      }
    }
    onEvent({ type: 'error', message: `Stopped after ${settings.maxSteps} steps (max reached).` })
  }
}
