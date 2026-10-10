import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolContext } from './tools'

const MAX_CONTEXT_CHARS = 200_000

// Find @path mentions in a prompt. Matches @foo/bar.ts, @"quoted path", etc.
export function extractMentions(prompt: string): string[] {
  const mentions: string[] = []
  // Quoted: @"some path/with spaces.ts"
  const quoted = prompt.matchAll(/@"([^"]+)"/g)
  for (const m of quoted) mentions.push(m[1])
  // Bare: @src/foo.ts (no spaces)
  const bare = prompt.matchAll(/(^|\s)@([^\s@"]+)/g)
  for (const m of bare) mentions.push(m[2])
  return [...new Set(mentions)]
}

function safeRead(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel)
  const relToRoot = path.relative(root, abs)
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null
  try {
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) return null
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

export interface ExpandedContext {
  prompt: string
  attached: string[]
  missing: string[]
}

// Expand @file mentions in the prompt into a context block the model can read.
export function expandMentions(prompt: string, ctx: ToolContext): ExpandedContext {
  const mentions = extractMentions(prompt)
  const attached: string[] = []
  const missing: string[] = []
  const blocks: string[] = []

  for (const rel of mentions) {
    const content = safeRead(path.resolve(ctx.workdir), rel)
    if (content === null) {
      missing.push(rel)
      continue
    }
    attached.push(rel)
    blocks.push(`### File: ${rel}\n\`\`\`\n${content.slice(0, MAX_CONTEXT_CHARS)}\n\`\`\``)
  }

  if (blocks.length === 0) {
    return { prompt, attached, missing }
  }

  const contextBlock = [
    'The user referenced the following file(s) as context:',
    '',
    ...blocks,
    ''
  ].join('\n')

  return {
    prompt: `${contextBlock}\n---\n\nUser request:\n${prompt}`,
    attached,
    missing
  }
}
