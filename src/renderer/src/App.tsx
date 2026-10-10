import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, ChatMessage, AgentEvent, ToolPreview, ToolCall, ConversationSummary } from '@shared/types'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalModal } from './components/ApprovalModal'
import { Markdown } from './components/Markdown'
import { PROMPT_TEMPLATES } from './components/templates'
import { Sidebar } from './components/Sidebar'

function uid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

interface PendingApproval {
  call: ToolCall
  preview: ToolPreview
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [mentions, setMentions] = useState<Array<{ path: string; exists: boolean }>>([])
  const [toast, setToast] = useState<string>('')
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [showSidebar, setShowSidebar] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [stepCount, setStepCount] = useState(0)
  const chatRef = useRef<HTMLDivElement>(null)

  const refreshConversations = (): void => {
    window.api.listConversations().then(setConversations).catch(() => {})
  }

  // Load settings + persisted conversation on startup.
  useEffect(() => {
    window.api.getSettings().then(setSettings).catch(() => {})
    window.api.getConversation().then((c) => {
      setMessages(c.messages ?? [])
      setActiveId(c.id)
    }).catch(() => {})
    refreshConversations()
  }, [])

  // Persist conversation whenever it changes (debounced-ish via timeout).
  useEffect(() => {
    const t = setTimeout(() => {
      window.api.setConversation(messages).catch(() => {})
      refreshConversations()
    }, 400)
    return () => clearTimeout(t)
  }, [messages])

  // Preview @file mentions in the composer (debounced).
  useEffect(() => {
    if (!input.includes('@')) {
      setMentions([])
      return
    }
    const t = setTimeout(() => {
      window.api.previewMentions(input, settings.workdir).then(setMentions).catch(() => setMentions([]))
    }, 250)
    return () => clearTimeout(t)
  }, [input, settings.workdir])

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // Tick the elapsed timer while a run is active.
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    setElapsed(0)
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [running])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        newChat()
      } else if (mod && e.key === '/') {
        e.preventDefault()
        setShowSettings((s) => !s)
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setShowSidebar((s) => !s)
      } else if (e.key === 'Escape' && running) {
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  useEffect(() => {
    const off = window.api.onAgentEvent((event: AgentEvent) => {
      switch (event.type) {
        case 'assistant_delta': {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant' && last.id === 'streaming') {
              return [...prev.slice(0, -1), { ...last, content: last.content + event.text }]
            }
            return [
              ...prev,
              { id: 'streaming', role: 'assistant', content: event.text, createdAt: Date.now() }
            ]
          })
          break
        }
        case 'assistant_message': {
          setMessages((prev) => {
            const withoutStreaming = prev.filter((m) => m.id !== 'streaming')
            return [...withoutStreaming, { ...event.message, id: event.message.id || uid('msg') }]
          })
          break
        }
        case 'tool_call': {
          setMessages((prev) => {
            const withoutStreaming = prev.filter((m) => m.id !== 'streaming')
            return [
              ...withoutStreaming,
              {
                id: uid('tool'),
                role: 'assistant' as const,
                content: '',
                toolCalls: [event.call],
                createdAt: Date.now()
              }
            ]
          })
          break
        }
        case 'command_output': {
          // Append streaming stdout/stderr to the matching tool card.
          setMessages((prev) => {
            const copy = [...prev]
            for (let i = copy.length - 1; i >= 0; i--) {
              const m = copy[i]
              if (m.toolCalls && m.toolCalls.some((c) => c.id === event.callId)) {
                const existing = (m.toolResults ?? []).find((r) => r.id === event.callId)
                if (existing) {
                  const updated = m.toolResults!.map((r) =>
                    r.id === event.callId ? { ...r, output: r.output + event.chunk, ok: true } : r
                  )
                  copy[i] = { ...m, toolResults: updated }
                } else {
                  copy[i] = {
                    ...m,
                    toolResults: [
                      ...(m.toolResults ?? []),
                      { id: event.callId, name: 'run_command', ok: true, output: event.chunk }
                    ]
                  }
                }
                break
              }
            }
            return copy
          })
          break
        }
        case 'tool_result': {
          // Replace the streaming output with the final, complete result.
          setMessages((prev) => {
            const copy = [...prev]
            for (let i = copy.length - 1; i >= 0; i--) {
              const m = copy[i]
              if (m.toolCalls && m.toolCalls.some((c) => c.id === event.result.id)) {
                const idx = (m.toolResults ?? []).findIndex((r) => r.id === event.result.id)
                if (idx >= 0) {
                  const updated = [...m.toolResults!]
                  updated[idx] = event.result
                  copy[i] = { ...m, toolResults: updated }
                } else {
                  copy[i] = { ...m, toolResults: [...(m.toolResults ?? []), event.result] }
                }
                break
              }
            }
            return copy
          })
          break
        }
        case 'tool_approval': {
          setApproval({ call: event.call, preview: event.preview })
          break
        }
        case 'step': {
          setStepCount(event.step + 1)
          break
        }
        case 'done': {
          setMessages((prev) => prev.filter((m) => m.id !== 'streaming'))
          setRunning(false)
          break
        }
        case 'error': {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== 'streaming'),
            { id: uid('err'), role: 'assistant', content: `⚠️ ${event.message}`, createdAt: Date.now() }
          ])
          setRunning(false)
          break
        }
        default:
          break
      }
    })
    return off
  }, [])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const canRun = useMemo(() => input.trim().length > 0 && !running, [input, running])

  const send = async (): Promise<void> => {
    const prompt = input.trim()
    if (!prompt || running) return
    setMessages((prev) => [
      ...prev,
      { id: uid('u'), role: 'user', content: prompt, createdAt: Date.now() }
    ])
    setInput('')
    setStepCount(0)
    setElapsed(0)
    setRunning(true)
    try {
      await window.api.runAgent({ prompt, settings })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((prev) => [
        ...prev,
        { id: uid('err'), role: 'assistant', content: `⚠️ ${msg}`, createdAt: Date.now() }
      ])
      setRunning(false)
    }
  }

  const cancel = (): void => {
    window.api.cancelAgent()
    setApproval(null)
    setRunning(false)
  }

  const decideApproval = (approved: boolean): void => {
    if (approval) {
      window.api.approveTool({ callId: approval.call.id, approved }).catch(() => {})
    }
    setApproval(null)
  }

  const newChat = (): void => {
    if (running) window.api.cancelAgent()
    window.api.newConversation().then((c) => {
      setMessages([])
      setActiveId(c.id)
      setApproval(null)
      setRunning(false)
      refreshConversations()
    }).catch(() => {})
  }

  const selectConv = (id: string): void => {
    if (id === activeId) return
    if (running) window.api.cancelAgent()
    window.api.selectConversation(id).then((c) => {
      if (c) {
        setMessages(c.messages ?? [])
        setActiveId(c.id)
        setApproval(null)
        setRunning(false)
        refreshConversations()
      }
    }).catch(() => {})
  }

  const deleteConv = (id: string): void => {
    window.api.deleteConversation(id).then((c) => {
      setMessages(c.messages ?? [])
      setActiveId(c.id)
      setRunning(false)
      refreshConversations()
    }).catch(() => {})
  }

  const exportChat = (): void => {
    window.api
      .exportChat()
      .then((p) => {
        if (p) setToast(`Exported to ${p}`)
      })
      .catch((e: unknown) => setToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`))
  }
  void canRun
  void cancel

  return (
    <div className="app">
      <div className="titlebar">
        <div className="logo" />
        <h1>Claude Code GUI</h1>
        <button className="btn" onClick={() => setShowSidebar((s) => !s)} title="Chat history">
          {showSidebar ? '☰ Hide' : '☰ Chats'}
        </button>
        {settings.workdir && <span className="workdir-pill">{settings.workdir}</span>}
        <div className="spacer" />
        <button className="btn" onClick={exportChat} disabled={messages.length === 0} title="Export this chat to Markdown">
          ⤓ Export
        </button>
        <button className="btn" onClick={newChat} disabled={running} title="Start a fresh conversation">
          ＋ New Chat
        </button>
        <button className="btn" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? 'Hide Settings' : '⚙ Settings'}
        </button>
      </div>

      {approval && <ApprovalModal preview={approval.preview} call={approval.call} onDecide={decideApproval} />}

      {toast && <div className="toast">{toast}</div>}

      <div className="body">
        {showSidebar && (
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConv}
            onNew={newChat}
            onDelete={deleteConv}
            onClose={() => setShowSidebar(false)}
          />
        )}
        <div className="main-col">
          <div className="chat" ref={chatRef}>
            {messages.length === 0 ? (
              <div className="empty">
                <strong>Welcome 👋</strong>
                <br />
                Pick a backend in <em>Settings</em>, choose your project folder,
                <br />
                then describe what you want to build or fix.
                <div className="shortcuts">
                  <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> send</span>
                  <span><kbd>Ctrl</kbd>+<kbd>K</kbd> new chat</span>
                  <span><kbd>Ctrl</kbd>+<kbd>B</kbd> chats</span>
                  <span><kbd>Ctrl</kbd>+<kbd>/</kbd> settings</span>
                  <span><kbd>Esc</kbd> stop</span>
                </div>
              </div>
            ) : (
              messages.map((m) => <MessageView key={m.id} message={m} />)
            )}
          </div>

          <div className="composer">
            {running && (
              <div className="run-status">
                <span className="run-dot" />
                <span>Agent working…</span>
                <span className="run-meta">
                  {stepCount > 0 ? `${stepCount} step${stepCount === 1 ? '' : 's'}` : 'thinking'}
                  {' · '}
                  {elapsed}s
                </span>
              </div>
            )}
            <div className="quick-actions">
              {PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="qa-btn"
                  disabled={running}
                  title={t.build({ workdir: settings.workdir })}
                  onClick={() => setInput(t.build({ workdir: settings.workdir }))}
                >
                  <span className="qa-icon">{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
            {mentions.length > 0 && (
              <div className="mention-chips">
                {mentions.map((m) => (
                  <span key={m.path} className={`chip ${m.exists ? 'ok' : 'missing'}`} title={m.path}>
                    📎 {m.path} {m.exists ? '' : '(not found)'}
                  </span>
                ))}
              </div>
            )}
            <textarea
              value={input}
              placeholder={running ? 'Working…' : 'Ask the agent… (use @filename to attach a file as context)'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            {running ? (
              <button className="btn" onClick={cancel}>■ Stop</button>
            ) : (
              <button className="btn primary" disabled={!canRun} onClick={() => void send()}>
                Send ⏎
              </button>
            )}
          </div>
        </div>

        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={(next) => {
              setSettings(next)
              window.api.setSettings(next).catch(() => {})
            }}
          />
        )}
      </div>
    </div>
  )
}

function MessageView({ message }: { message: ChatMessage }): JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="msg user">
        <span className="role">You</span>
        <div className="bubble">{message.content}</div>
      </div>
    )
  }

  return (
    <div className="msg assistant">
      {message.content && (
        <>
          <span className="role">Agent</span>
          <div className="bubble"><Markdown text={message.content} /></div>
        </>
      )}
      {message.toolCalls?.map((call) => {
        const result = message.toolResults?.find((r) => r.id === call.id)
        const isCommand = call.name === 'run_command'
        return (
          <div className="toolcard" key={call.id}>
            <div className="th">
              <span>🔧 {call.name}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {result ? (
                <>
                  {isCommand && (
                    <button
                      className="md-copy"
                      onClick={() => void navigator.clipboard.writeText(result.output)}
                      title="Copy output"
                    >
                      Copy
                    </button>
                  )}
                  <span className={result.ok ? 'ok' : 'bad'}>{result.ok ? 'ok' : 'error'}</span>
                </>
              ) : (
                <span className="bad running-dot">running…</span>
              )}
            </div>
            {!isCommand && <pre>{JSON.stringify(call.args, null, 2)}</pre>}
            {isCommand && !result && call.args.command ? (
              <pre className="cmd-line">$ {String(call.args.command)}</pre>
            ) : null}
            {result && <pre className={isCommand ? 'cmd-out' : ''}>{result.output}</pre>}
          </div>
        )
      })}
    </div>
  )
}

