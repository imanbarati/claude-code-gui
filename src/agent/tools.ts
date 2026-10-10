import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import type { ToolCall, ToolResult, ToolPreview } from '@shared/types'

const MAX_FILE_CHARS = 120_000
const MAX_OUTPUT_CHARS = 40_000

// Callback for streaming incremental output (used by run_command).
export type OutputCallback = (chunk: string) => void

export interface ToolContext {
  workdir: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// OpenAI/Ollama-style JSON schemas for tool declarations.
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_file',
    description:
      'Read the contents of a text file (relative to the project root). Returns line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file, relative to project root.' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file with the given content (relative to the project root). Creates parent directories.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file, relative to project root.' },
        content: { type: 'string', description: 'Full content to write.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_dir',
    description: 'List the contents of a directory (relative to the project root).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path, relative to project root.' }
      },
      required: ['path']
    }
  },
  {
    name: 'run_command',
    description:
      'Run a shell command inside the project root and return its combined stdout/stderr. Use for build/test/git.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in ms (default 60000).' }
      },
      required: ['command']
    }
  }
]

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n... [truncated ${s.length - max} chars]`
}

// Resolve a path and ensure it stays within the project root.
function safeResolve(ctx: ToolContext, rel: string): string {
  const root = path.resolve(ctx.workdir)
  const abs = path.resolve(root, rel || '.')
  const relToRoot = path.relative(root, abs)
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error(`Path escapes project root: ${rel}`)
  }
  return abs
}

function formatWithLineNumbers(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
    .join('\n')
}

async function execTool(ctx: ToolContext, call: ToolCall, onOutput?: OutputCallback): Promise<ToolResult> {
  const { name, args, id } = call
  try {
    switch (name) {
      case 'read_file': {
        const abs = safeResolve(ctx, String(args.path ?? ''))
        const stat = fs.statSync(abs)
        if (stat.isDirectory()) throw new Error('Path is a directory, use list_dir.')
        const content = fs.readFileSync(abs, 'utf8')
        return { id, name, ok: true, output: truncate(formatWithLineNumbers(content), MAX_FILE_CHARS) }
      }
      case 'write_file': {
        const abs = safeResolve(ctx, String(args.path ?? ''))
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, String(args.content ?? ''), 'utf8')
        return { id, name, ok: true, output: `Wrote ${String(args.content ?? '').length} chars to ${args.path}` }
      }
      case 'list_dir': {
        const abs = safeResolve(ctx, String(args.path ?? '.'))
        const entries = fs.readdirSync(abs, { withFileTypes: true })
        const lines = entries.map((e) => `${e.isDirectory() ? '[dir] ' : '[file]'} ${e.name}`)
        return { id, name, ok: true, output: lines.join('\n') || '(empty)' }
      }
      case 'run_command': {
        const command = String(args.command ?? '')
        if (!command.trim()) throw new Error('Empty command.')
        const timeoutMs = Number(args.timeoutMs ?? 60_000)
        return await runCommandStreaming(ctx, id, command, timeoutMs, onOutput)
      }
      default:
        return { id, name, ok: false, output: `Unknown tool: ${name}` }
    }
  } catch (e: any) {
    return { id, name, ok: false, output: `Error: ${e?.message ?? String(e)}` }
  }
}

// Run a shell command via spawn so stdout/stderr stream live to the UI.
function runCommandStreaming(
  ctx: ToolContext,
  id: string,
  command: string,
  timeoutMs: number,
  onOutput?: OutputCallback
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve) => {
    const isWin = process.platform === 'win32'
    const child = isWin
      ? spawn(command, { cwd: path.resolve(ctx.workdir), shell: true, windowsHide: true })
      : spawn('bash', ['-lc', command], { cwd: path.resolve(ctx.workdir), windowsHide: true })

    let combined = ''
    let timedOut = false

    const append = (s: string): void => {
      combined += s
      onOutput?.(s)
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => append(d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => append(d.toString('utf8')))

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ id, name: 'run_command', ok: false, output: truncate(`${combined}\n${err.message}`, MAX_OUTPUT_CHARS) })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const ok = code === 0 && !timedOut
      const suffix = timedOut ? `\n[timed out after ${timeoutMs}ms]` : `\n[exit code ${code}]`
      const out = truncate((combined || '(no output)') + suffix, MAX_OUTPUT_CHARS)
      resolve({ id, name: 'run_command', ok, output: out })
    })
  })
}

export async function runTool(ctx: ToolContext, call: ToolCall, onOutput?: OutputCallback): Promise<ToolResult> {
  return execTool(ctx, call, onOutput)
}


// ---- Approval previews ------------------------------------------------------

const MUTATING_TOOLS = new Set(['write_file', 'run_command'])

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name)
}

// A compact, dependency-free line diff using common prefix/suffix trimming.
export function simpleDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.length ? oldStr.split(/\r?\n/) : []
  const newLines = newStr.length ? newStr.split(/\r?\n/) : []

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const context = 2
  const removed = oldLines.slice(prefix, oldLines.length - suffix)
  const added = newLines.slice(prefix, newLines.length - suffix)

  const lines: string[] = []
  for (let i = Math.max(0, prefix - context); i < prefix; i++) lines.push(`  ${oldLines[i]}`)
  for (const r of removed) lines.push(`- ${r}`)
  for (const a of added) lines.push(`+ ${a}`)
  for (let i = newLines.length - suffix; i < Math.min(newLines.length, newLines.length - suffix + context); i++) {
    lines.push(`  ${newLines[i]}`)
  }

  return lines.join('\n')
}

// Build a preview of a tool call for the approval UI. Never throws.
export function previewTool(ctx: ToolContext, call: ToolCall): ToolPreview {
  const name = call.name
  const args = call.args
  try {
    if (name === 'write_file') {
      const rel = String(args.path ?? '')
      const abs = safeResolve(ctx, rel)
      const newContent = String(args.content ?? '')
      let oldContent = ''
      let exists = false
      try {
        oldContent = fs.readFileSync(abs, 'utf8')
        exists = true
      } catch {
        exists = false
      }
      const oldLines = exists ? oldContent.split(/\r?\n/).length : 0
      const newLines = newContent.split(/\r?\n/).length
      return {
        mutates: true,
        kind: 'write',
        path: rel,
        summary: `${exists ? 'Overwrite' : 'Create'} ${rel} (${oldLines} → ${newLines} lines)`,
        diff: exists
          ? simpleDiff(oldContent, newContent)
          : newContent.split(/\r?\n/).map((l) => `+ ${l}`).join('\n')
      }
    }
    if (name === 'run_command') {
      return {
        mutates: true,
        kind: 'command',
        command: String(args.command ?? ''),
        summary: 'Run command in project root'
      }
    }
    return { mutates: false, kind: 'read', summary: `${name} (no changes)` }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { mutates: true, kind: 'read', summary: `Blocked: ${msg}` }
  }
}
