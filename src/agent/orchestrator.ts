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

export interface ConnectionResult {
  ok: boolean
  message: string
}

// Verify the selected backend is reachable/configured before running.
export async function testConnection(settings: Settings): Promise<ConnectionResult> {
  const id = settings.backend
  try {
    if (id === 'ollama') {
      const res = await fetch(`${settings.ollamaUrl}/api/tags`)
      if (!res.ok) return { ok: false, message: `Ollama responded ${res.status}. Is it running at ${settings.ollamaUrl}?` }
      const data = (await res.json()) as { models?: Array<{ name: string }> }
      const count = data.models?.length ?? 0
      if (count === 0) {
        return { ok: true, message: 'Connected to Ollama, but no models installed. Try: ollama pull qwen2.5-coder:7b' }
      }
      const has = data.models!.some((m) => m.name === settings.ollamaModel)
      return {
        ok: true,
        message: has
          ? `Ollama ready (${count} models, "${settings.ollamaModel}" available).`
          : `Ollama ready (${count} models), but "${settings.ollamaModel}" not found.`
      }
    }

    if (id === 'openrouter') {
      if (!settings.openRouterKey.trim()) {
        return { ok: false, message: 'No OpenRouter API key set. Get a free key at openrouter.ai.' }
      }
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${settings.openRouterKey}` }
      })
      if (res.status === 401) return { ok: false, message: 'OpenRouter rejected the key (401). Check it and try again.' }
      if (!res.ok) return { ok: false, message: `OpenRouter responded ${res.status}.` }
      return { ok: true, message: `OpenRouter key valid. Using "${settings.openRouterModel}".` }
    }

    // claude-code: verify the CLI is on PATH.
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)
    const cmd = settings.claudeCommand || 'claude'
    try {
      await execAsync(`${cmd} --version`, { timeout: 15000, windowsHide: true })
      return { ok: true, message: `Claude Code CLI found ("${cmd}"). Uses your Claude login.` }
    } catch {
      return {
        ok: false,
        message: `Claude Code CLI ("${cmd}") not found. Install: npm i -g @anthropic-ai/claude-code`
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `Connection test failed: ${msg}` }
  }
}