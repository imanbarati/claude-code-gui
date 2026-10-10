// Unit tests for the renderer's pure helpers (highlighter + prompt templates).
// Bundled with esbuild then run with node.
import { tokenize, normalizeLang } from '../src/renderer/src/components/highlight'
import { PROMPT_TEMPLATES, buildPrompt } from '../src/renderer/src/components/templates'
import { parseDiff } from '../src/renderer/src/components/ApprovalModal'

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`)
  if (!cond) failures++
}

// Reassemble token text and confirm it equals the original source (no loss).
function join(tokens: Array<{ text: string }>): string {
  return tokens.map((t) => t.text).join('')
}
function findKind(tokens: Array<{ text: string; kind: string }>, text: string): string | undefined {
  return tokens.find((t) => t.text === text)?.kind
}

// --- highlighter ---
const js = 'const x = 42; // hi\nfunction foo(a) { return "s"; }'
const t1 = tokenize(js, 'javascript')
check('tokenize preserves source', join(t1) === js)
check('keyword const', findKind(t1, 'const') === 'keyword')
check('number 42', findKind(t1, '42') === 'number')
check('line comment', t1.some((t) => t.kind === 'comment' && t.text.startsWith('//')))
check('string "s"', findKind(t1, '"s"') === 'string')
check('function call foo', findKind(t1, 'foo') === 'func')

const py = 'def add(a, b):\n    # sum\n    return a + b'
const t2 = tokenize(py, 'py')
check('py keyword def', findKind(t2, 'def') === 'keyword')
check('py hash comment', t2.some((t) => t.kind === 'comment' && t.text.startsWith('#')))
check('py preserves source', join(t2) === py)

check('normalizeLang alias', normalizeLang('jsx') === 'js' && normalizeLang('PY') === 'python' && normalizeLang('golang') === 'go')

// ts inherits js keywords
const ts = 'interface Foo { x: number }\nconst y: Foo = { x: 1 }'
const t3 = tokenize(ts, 'ts')
check('ts interface keyword', findKind(t3, 'interface') === 'keyword')
check('ts const keyword (from js)', findKind(t3, 'const') === 'keyword')
check('ts type Foo', findKind(t3, 'Foo') === 'type')

// --- templates ---
check('templates count', PROMPT_TEMPLATES.length >= 5)
check('template ids unique', new Set(PROMPT_TEMPLATES.map((t) => t.id)).size === PROMPT_TEMPLATES.length)

const withSel = buildPrompt('tests', { selection: 'add(1,2)', workdir: '' })
check('template uses selection', withSel.includes('add(1,2)') && withSel.includes('unit tests'))

const noSel = buildPrompt('explain', { workdir: 'C:\\proj' })
check('template falls back to workdir', noSel.includes('C:\\proj'))

check('buildPrompt unknown id returns empty', buildPrompt('nope', { workdir: '' }) === '')

// --- diff parsing ---
const diff = '  context line\n- old thing\n+ new thing\n@@ hunk @@'
const dl = parseDiff(diff)
check('parseDiff classifies lines', dl[0].kind === 'ctx' && dl[1].kind === 'del' && dl[2].kind === 'add' && dl[3].kind === 'meta', JSON.stringify(dl.map((l) => l.kind)))
check('parseDiff strips markers', dl[1].text === 'old thing' && dl[2].text === 'new thing', JSON.stringify(dl.map((l) => l.text)))
check('parseDiff context strips 2 spaces', dl[0].text === 'context line')

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
