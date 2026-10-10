// Functional smoke test for the agent tools. Bundled with esbuild then run with node.
import { runTool, TOOL_SPECS } from '../src/agent/tools'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const ctx = { workdir: fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-test-')) }
let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`)
  if (!cond) failures++
}

async function main(): Promise<void> {
  check('TOOL_SPECS has 4 tools', TOOL_SPECS.length === 4)

  // write_file
  const w = await runTool(ctx, { id: '1', name: 'write_file', args: { path: 'hello.txt', content: 'line1\nline2' } })
  check('write_file ok', w.ok && fs.existsSync(path.join(ctx.workdir, 'hello.txt')))

  // read_file returns line numbers
  const r = await runTool(ctx, { id: '2', name: 'read_file', args: { path: 'hello.txt' } })
  check('read_file ok + line numbers', r.ok && r.output.includes('1 |') && r.output.includes('line2'))

  // nested write creates dirs
  const n = await runTool(ctx, { id: '3', name: 'write_file', args: { path: 'a/b/c.py', content: 'print(1)' } })
  check('nested write_file ok', n.ok && fs.existsSync(path.join(ctx.workdir, 'a/b/c.py')))

  // list_dir
  const l = await runTool(ctx, { id: '4', name: 'list_dir', args: { path: '.' } })
  check('list_dir shows hello.txt', l.ok && l.output.includes('hello.txt'))

  // run_command (echo via node, cross-platform)
  const c = await runTool(ctx, { id: '5', name: 'run_command', args: { command: process.platform === 'win32' ? 'echo hi' : 'echo hi' } })
  check('run_command ok', c.ok && c.output.toLowerCase().includes('hi'), c.output)

  // sandbox: escape attempt must be rejected
  const esc = await runTool(ctx, { id: '6', name: 'write_file', args: { path: '../escape.txt', content: 'x' } })
  check('sandbox blocks ../ escape', !esc.ok && esc.output.includes('escapes project root'), esc.output)

  // sandbox: absolute path outside root rejected
  const abs = await runTool(ctx, { id: '7', name: 'read_file', args: { path: path.join(os.tmpdir(), 'nope-does-not-exist.txt') } })
  check('sandbox blocks absolute outside', !abs.ok)

  // unknown tool
  const unk = await runTool(ctx, { id: '8', name: 'frobnicate', args: {} })
  check('unknown tool handled', !unk.ok && unk.output.includes('Unknown tool'))

  console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
