import { spawn } from 'node:child_process'
import * as readline from 'node:readline'
import type { Backend, BackendRunArgs } from './types'
import type { ChatMessage, ToolCall } from '@shared/types'

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Drives the official Claude Code CLI (@anthropic-ai/claude-code) in headless,
 * streaming mode. The CLI performs its own tool use (Read/Write/Bash/Edit) using
 * the user's login or ANTHROPIC_API_KEY, so we simply relay its events.
 */
export class ClaudeCodeBackend implements Backend {
  id = 'claude-code'

  async run(args: BackendRunArgs): Promise<void> {
    const { settings, prompt, onEvent, signal } = args
    const cwd = settings.workdir || process.cwd()

    const cliArgs = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose'
    ]
    if (settings.autoApproveTools) {
      cliArgs.push('--dangerously-skip-permissions')
    }

    const cmd = settings.claudeCommand || 'claude'
    // On Windows, the CLI is a .cmd shim; spawn via shell to resolve it.
    const child = spawn(cmd, cliArgs, {
      cwd,
      shell: true,
      env: { ...process.env }
    })

    const onAbort = () => child.kill()
    signal.addEventListener('abort', onAbort, { once: true })

    let buffer = ''
    let doneSeen = false

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) this.handleLine(line, onEvent)
      }
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    await new Promise<void>((resolve) => {
      child.on('close', (code) => {
        // flush remaining buffered line
        if (buffer.trim()) this.handleLine(buffer.trim(), onEvent)
        if (!doneSeen && code !== 0 && stderr.trim()) {
          onEvent({ type: 'error', message: stderr.trim() })
        }
        if (!doneSeen) onEvent({ type: 'done' })
        signal.removeEventListener('abort', onAbort)
        resolve()
      })
      child.on('error', (err) => {
        onEvent({
          type: 'error',
          message:
            `Failed to start "${cmd}". Is Claude Code installed? ` +
            `Install with: npm i -g @anthropic-ai/claude-code\n\n${err.message}`
        })
        onEvent({ type: 'done' })
        signal.removeEventListener('abort', onAbort)
        resolve()
      })
    })
  }

  private handleLine(line: string, onEvent: (e: any) => void): void {
    let evt: any
    try {
      evt = JSON.parse(line)
    } catch {
      return
    }

    switch (evt.type) {
      case 'assistant': {
        const content = evt.message?.content ?? []
        const text = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('')
        const toolCalls: ToolCall[] = content
          .filter((c: any) => c.type === 'tool_use')
          .map((c: any) => ({ id: c.id, name: c.name, args: c.input ?? {} }))

        if (text) onEvent({ type: 'assistant_delta', text })
        if (toolCalls.length) {
          const msg: ChatMessage = {
            id: makeId('msg'),
            role: 'assistant',
            content: text,
            toolCalls,
            createdAt: Date.now()
          }
          onEvent({ type: 'assistant_message', message: msg })
          for (const call of toolCalls) onEvent({ type: 'tool_call', call })
        }
        break
      }
      case 'user': {
        // Tool results come back as user messages containing tool_result blocks.
        const content = evt.message?.content ?? []
        for (const c of content) {
          if (c.type === 'tool_result') {
            onEvent({
              type: 'tool_result',
              result: {
                id: c.tool_use_id,
                name: 'tool',
                ok: !c.is_error,
                output: typeof c.content === 'string' ? c.content : JSON.stringify(c.content)
              }
            })
          }
        }
        break
      }
      case 'result': {
        if (evt.subtype === 'error') {
          onEvent({ type: 'error', message: evt.result ?? 'Claude Code error' })
        }
        onEvent({ type: 'done' })
        break
      }
      default:
        break
    }
  }
}
