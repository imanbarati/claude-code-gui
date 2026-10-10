import type { ToolCall, ToolPreview } from '@shared/types'

interface Props {
  call: ToolCall
  preview: ToolPreview
  onDecide: (approved: boolean) => void
}

export function ApprovalModal({ call, preview, onDecide }: Props): JSX.Element {
  const title = preview.kind === 'command' ? 'Run command?' : preview.kind === 'write' ? 'Apply file change?' : 'Approve tool?'

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

        {preview.kind === 'write' && preview.diff && <pre className="modal-diff">{preview.diff}</pre>}

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
