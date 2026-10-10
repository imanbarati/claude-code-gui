// Functional smoke test for the agent tools. Bundled with esbuild then run with node.
import { runTool, TOOL_SPECS, previewTool, simpleDiff, isMutatingTool } from '../src/agent/tools'
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

  // --- preview / diff / mutating classification ---
  check('isMutatingTool write/command', isMutatingTool('write_file') && isMutatingTool('run_command'))
  check('isMutatingTool read=false', !isMutatingTool('read_file') && !isMutatingTool('list_dir'))

  // simpleDiff: only changed lines marked, context preserved
  const d = simpleDiff('a\nb\nc\nd\ne', 'a\nb\nC\nd\ne')
  check('simpleDiff marks -/+', d.includes('- c') && d.includes('+ C'), d)
  check('simpleDiff keeps context', d.includes('  a') && d.includes('  d'))

  // previewTool: create preview for new file (all + lines)
  const pCreate = previewTool(ctx, { id: 'p1', name: 'write_file', args: { path: 'new.md', content: 'hi\nthere' } })
  check('preview create kind=write', pCreate.mutates && pCreate.kind === 'write' && pCreate.summary.includes('Create'))
  check('preview create has +diff', !!pCreate.diff && pCreate.diff.includes('+ hi'))

  // previewTool: overwrite preview shows diff against existing hello.txt
  const pOver = previewTool(ctx, { id: 'p2', name: 'write_file', args: { path: 'hello.txt', content: 'line1\nCHANGED' } })
  check('preview overwrite says Overwrite', pOver.summary.includes('Overwrite') && !!pOver.diff && pOver.diff.includes('+ CHANGED'))

  // previewTool: command preview
  const pCmd = previewTool(ctx, { id: 'p3', name: 'run_command', args: { command: 'echo hi' } })
  check('preview command kind=command', pCmd.mutates && pCmd.kind === 'command' && pCmd.command === 'echo hi')

  // previewTool: escape path is blocked (never throws)
  const pEsc = previewTool(ctx, { id: 'p4', name: 'write_file', args: { path: '../x.txt', content: 'x' } })
  check('preview escape blocked', pEsc.summary.includes('Blocked'))

  // --- streaming command output ---
  let streamed = ''
  const cStream = await runTool(ctx, { id: '9', name: 'run_command', args: { command: 'echo streaming-test' } }, (chunk) => {
    streamed += chunk
  })
  check('run_command streams via onOutput', streamed.toLowerCase().includes('streaming-test'), streamed)
  check('run_command final result ok + exit code', cStream.ok && cStream.output.includes('exit code 0'), cStream.output)

  // failing command reports non-zero exit
  const cFail = await runTool(ctx, { id: '10', name: 'run_command', args: { command: process.platform === 'win32' ? 'exit /b 3' : 'exit 3' } })
  check('run_command reports failure exit code', !cFail.ok && /exit code 3/.test(cFail.output), cFail.output)

  console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
