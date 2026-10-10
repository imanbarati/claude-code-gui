// A tiny, dependency-free syntax highlighter.
// Tokenizes a single code string for a handful of common languages.
// Returns an ordered list of tokens the renderer maps to CSS classes.

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'func' | 'type' | 'punct'

export interface Token {
  text: string
  kind: TokenKind
}

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while class extends new this import export from default async await try catch throw typeof instanceof of in break continue switch case yield delete null undefined true false'.split(' '),
  ts: 'const let var function return if else for while class extends implements interface type enum namespace public private protected readonly new this import export from default async await try catch throw typeof instanceof of in break continue switch case yield delete null undefined true false as satisfies keyof infer'.split(' '),
  python: 'def return if elif else for while class import from as with try except finally raise lambda yield global nonlocal pass break continue and or not in is None True False assert del async await'.split(' '),
  java: 'public private protected class interface extends implements static final void int long double float boolean char String new return if else for while try catch throw throws this super import package abstract synchronized'.split(' '),
  c: 'int char float double void long short unsigned signed struct union enum typedef const static extern return if else for while do switch case break continue sizeof goto'.split(' '),
  cpp: 'int char float double void long short unsigned signed bool class struct union enum typedef const static extern return if else for while do switch case break continue sizeof goto namespace using template new delete this public private protected virtual'.split(' '),
  go: 'package import func return if else for range var const type struct interface map chan go defer select switch case break continue default nil true false string int int64 byte error make new'.split(' '),
  rust: 'fn let mut const static struct enum impl trait pub use mod return if else for while loop match break continue as in ref move crate self Self Some None Ok Err true false'.split(' '),
  bash: 'if then else elif fi for while do done case esac function return export local echo cd exit set'.split(' '),
  sh: 'if then else elif fi for while do done case esac function return export local echo cd exit set'.split(' '),
  json: 'true false null'.split(' ')
}

const HASH_COMMENT_LANGS = new Set(['python', 'bash', 'sh', 'yaml', 'yml', 'toml', 'ruby', 'r'])
const ALIASES: Record<string, string> = {
  javascript: 'js', jsx: 'js', tsx: 'ts', typescript: 'ts', py: 'python',
  shell: 'bash', zsh: 'bash', 'c++': 'cpp', golang: 'go', rs: 'rust'
}

export function normalizeLang(lang: string): string {
  const l = (lang || '').toLowerCase()
  return ALIASES[l] ?? l
}

function keywordsFor(lang: string): Set<string> {
  const base = normalizeLang(lang)
  const set = new Set<string>()
  for (const k of KEYWORDS[base] ?? []) set.add(k)
  // ts is a superset of js
  if (base === 'ts') for (const k of KEYWORDS.js) set.add(k)
  return set
}

export function tokenize(code: string, lang: string): Token[] {
  const base = normalizeLang(lang)
  const keywords = keywordsFor(base)
  const hashComment = HASH_COMMENT_LANGS.has(base)

  // Build a scanner regex. Order = priority.
  // Group 1: line comment   Group 2: string   Group 3: number   Group 4: identifier
  const lineComment = hashComment ? '#[^\\n]*' : '\\/\\/[^\\n]*'
  const blockComment = hashComment ? '(?!x)x' : '\\/\\*[\\s\\S]*?\\*\\/'
  const comment = `(${lineComment}|${blockComment})`
  const str = `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`
  const num = '(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)'
  const ident = '([A-Za-z_$][A-Za-z0-9_$]*)'

  const re = new RegExp(`${comment}|${str}|${num}|${ident}`, 'g')

  const tokens: Token[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) {
      tokens.push({ text: code.slice(last, m.index), kind: 'plain' })
    }
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], kind: 'comment' })
    } else if (m[2] !== undefined) {
      tokens.push({ text: m[2], kind: 'string' })
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], kind: 'number' })
    } else if (m[4] !== undefined) {
      const word = m[4]
      let kind: TokenKind = 'plain'
      if (keywords.has(word)) kind = 'keyword'
      else if (/^[A-Z]/.test(word)) kind = 'type'
      else if (code[m.index + word.length] === '(') kind = 'func'
      tokens.push({ text: word, kind })
    }
    last = re.lastIndex
  }
  if (last < code.length) {
    tokens.push({ text: code.slice(last), kind: 'plain' })
  }
  return tokens
}
