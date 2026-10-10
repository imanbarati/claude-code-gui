import type { ToolCall, ToolPreview } from '@shared/types'

interface Props {
  call: ToolCall
  preview: ToolPreview
  onDecide: (approved: boolean) => void
}

type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta'

interface DiffLine {
  kind: DiffLineKind
  text: string
}

// Split a unified-ish diff into colored lines. Lines starting with + / - are
// add/del; ' ' (or none) are context; @@ hunk headers are meta. A single space
// after the +/- marker (as produced by our diff) is also stripped.
export function parseDiff(diff: string): DiffLine[] {
  const stripMarker = (s: string): string => (s.startsWith(' ') ? s.slice(1) : s)
  return diff.split('\n').map((line) => {
    if (line.startsWith('@@')) return { kind: 'meta', text: line }
    if (line.startsWith('+')) return { kind: 'add', text: stripMarker(line.slice(1)) }
    if (line.startsWith('-')) return { kind: 'del', text: stripMarker(line.slice(1)) }
    if (line.startsWith('  ')) return { kind: 'ctx', text: line.slice(2) }
    return { kind: 'ctx', text: line }
  })
}

export function ApprovalModal({ call, preview, onDecide }: Props): JSX.Element {
  const title = preview.kind === 'command' ? 'Run command?' : preview.kind === 'write' ? 'Apply file change?' : 'Approve tool?'
  const diffLines = preview.kind === 'write' && preview.diff ? parseDiff(preview.diff) : []
  const added = diffLines.filter((l) => l.kind === 'add').length
  const removed = diffLines.filter((l) => l.kind === 'del').length

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <span className="modal-icon">{preview.kind === 'command' ? '▶' : '✎'}</span>
          <h3>{title}</h3>
        </div>

        <div className="modal-summary">{preview.summary}</div>

        {preview.kind === 'command' && preview.command && (
          <div className="modal-cmd">
            <span className="prompt">$</span> {preview.command}
          </div>
        )}

        {diffLines.length > 0 && (
          <>
            <div className="diff-legend">
              <span className="legend-add">+{added}</span>
              <span className="legend-del">−{removed}</span>
            </div>
            <div className="modal-diff">
              {diffLines.map((l, i) => (
                <div key={i} className={`diff-line diff-${l.kind}`}>
                  <span className="diff-sign">
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                  </span>
                  <span className="diff-text">{l.text}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-note">
          Tool: <code>{call.name}</code> — running inside your project folder.
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={() => onDecide(false)}>
            ✕ Deny
          </button>
          <button className="btn primary" onClick={() => onDecide(true)} autoFocus>
            ✓ Approve
          </button>
        </div>
      </div>
    </div>
  )
}
