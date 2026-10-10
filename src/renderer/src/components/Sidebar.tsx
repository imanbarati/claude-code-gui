import type { ConversationSummary } from '@shared/types'

interface Props {
  conversations: ConversationSummary[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onClose: () => void
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ts).toLocaleDateString()
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onClose }: Props): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">Chats</span>
        <button className="btn sm" onClick={onNew} title="New chat">＋ New</button>
        <button className="btn sm ghost" onClick={onClose} title="Hide chats">✕</button>
      </div>
      <div className="sidebar-list">
        {conversations.length === 0 && <div className="sidebar-empty">No chats yet</div>}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`conv-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="conv-main">
              <div className="conv-title" title={c.title}>{c.title}</div>
              <div className="conv-meta">
                {c.messageCount} msg · {relTime(c.updatedAt)}
              </div>
            </div>
            <button
              className="conv-del"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(c.id)
              }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
