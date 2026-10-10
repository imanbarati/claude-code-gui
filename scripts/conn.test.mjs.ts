// Unit test for the backend connection test logic (offline branches).
import { testConnection } from '../src/agent/orchestrator'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings } from '@shared/types'

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`)
  if (!cond) failures++
}

const base: Settings = { ...DEFAULT_SETTINGS }

async function main(): Promise<void> {
  // OpenRouter with no key -> clear failure, no network needed.
  const or = await testConnection({ ...base, backend: 'openrouter', openRouterKey: '' })
  check('openrouter no key fails', !or.ok && or.message.toLowerCase().includes('api key'), or.message)

  // Claude Code with a bogus command name -> should report not found (no network).
  const cc = await testConnection({ ...base, backend: 'claude-code', claudeCommand: 'definitely-not-a-real-cli-xyz' })
  check('claude-code missing cli reports not found', !cc.ok && cc.message.toLowerCase().includes('not found'), cc.message)

  console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
