// A tiny, dependency-free Markdown renderer for chat messages.
// Supports: fenced code blocks (```), inline `code`, **bold**, *italic*,
// headings (#..###), unordered/ordered lists, blockquotes (>), and links.

import type { ReactNode } from 'react'
import { tokenize } from './highlight'

// Render inline markdown within a single line of text.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Order matters: code first so we don't format inside it.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${i++}`
    if (token.startsWith('`')) {
      nodes.push(<code className="md-code" key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
      if (m) {
        nodes.push(
          <a key={key} href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>
        )
      }
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fence = line.match(/^```(\w+)?\s*$/)
    if (fence) {
      const lang = fence[1] ?? ''
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // skip closing fence
      blocks.push(
        <CodeBlock key={`b${key++}`} code={buf.join('\n')} lang={lang} />
      )
      continue
    }

    // Heading
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const content = renderInline(heading[2], `h${key}`)
      blocks.push(
        level === 1 ? <h3 key={`b${key++}`}>{content}</h3>
          : level === 2 ? <h4 key={`b${key++}`}>{content}</h4>
          : <h5 key={`b${key++}`}>{content}</h5>
      )
      i++
      continue
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push(<blockquote key={`b${key++}`}>{renderInline(buf.join(' '), `q${key}`)}</blockquote>)
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={`b${key++}`}>
          {items.map((it, idx) => <li key={idx}>{renderInline(it, `ul${key}-${idx}`)}</li>)}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={`b${key++}`}>
          {items.map((it, idx) => <li key={idx}>{renderInline(it, `ol${key}-${idx}`)}</li>)}
        </ol>
      )
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph (consume consecutive non-empty, non-special lines)
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(<p key={`b${key++}`}>{renderInline(para.join(' '), `p${key}`)}</p>)
  }

  return <div className="md">{blocks}</div>
}

function CodeBlock({ code, lang }: { code: string; lang: string }): JSX.Element {
  const tokens = tokenize(code, lang)
  return (
    <div className="md-pre-wrap">
      <div className="md-pre-bar">
        <span className="md-lang">{lang || 'code'}</span>
        <button className="md-copy" onClick={() => void navigator.clipboard.writeText(code)}>
          Copy
        </button>
      </div>
      <pre>
        <code>
          {tokens.map((t, i) => (
            <span key={i} className={`tok tok-${t.kind}`}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
