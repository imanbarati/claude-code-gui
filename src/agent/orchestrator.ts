import type { Backend } from './backends/types'
import { OllamaBackend } from './backends/ollama'
import { OpenRouterBackend } from './backends/openrouter'
import { ClaudeCodeBackend } from './backends/claudeCode'
import type { BackendId, Settings } from '@shared/types'

const backends: Record<BackendId, Backend> = {
  'claude-code': new ClaudeCodeBackend(),
  ollama: new OllamaBackend(),
  openrouter: new OpenRouterBackend()
}

export function getBackend(id: BackendId): Backend {
  const b = backends[id]
  if (!b) throw new Error(`Unknown backend: ${id}`)
  return b
}

export async function listModels(settings: Settings): Promise<string[]> {
  try {
    const b = getBackend(settings.backend)
    if (!b.listModels) return []
    return await b.listModels(settings)
  } catch (e: any) {
    throw new Error(e?.message ?? String(e))
  }
}
