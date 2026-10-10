import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, ChatMessage, AgentEvent, ToolPreview, ToolCall } from '@shared/types'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalModal } from './components/ApprovalModal'

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
  const chatRef = useRef<HTMLDivElement>(null)

  // Load settings + persisted conversation on startup.
  useEffect(() => {
    window.api.getSettings().then(setSettings).catch(() => {})
    window.api.getConversation().then((c) => setMessages(c.messages ?? [])).catch(() => {})
  }, [])

  // Persist conversation whenever it changes (debounced-ish via timeout).
  useEffect(() => {
    const t = setTimeout(() => {
      window.api.setConversation({ messages }).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [messages])

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
        case 'tool_result': {
          setMessages((prev) => {
            const copy = [...prev]
            for (let i = copy.length - 1; i >= 0; i--) {
              const m = copy[i]
              if (m.toolCalls && m.toolCalls.some((c) => c.id === event.result.id)) {
                copy[i] = { ...m, toolResults: [...(m.toolResults ?? []), event.result] }
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
    setMessages([])
    setApproval(null)
    setRunning(false)
    window.api.clearConversation().catch(() => {})
  }
  void canRun
  void cancel

  return (
    <div className="app">
      <div className="titlebar">
        <div className="logo" />
        <h1>Claude Code GUI</h1>
        {settings.workdir && <span className="workdir-pill">{settings.workdir}</span>}
        <div className="spacer" />
        <button className="btn" onClick={newChat} disabled={running} title="Start a fresh conversation">
          ＋ New Chat
        </button>
        <button className="btn" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? 'Hide Settings' : '⚙ Settings'}
        </button>
      </div>

      {approval && <ApprovalModal preview={approval.preview} call={approval.call} onDecide={decideApproval} />}

      <div className="body">
        <div className="main-col">
          <div className="chat" ref={chatRef}>
            {messages.length === 0 ? (
              <div className="empty">
                <strong>Welcome 👋</strong>
                <br />
                Pick a backend in <em>Settings</em>, choose your project folder,
                <br />
                then describe what you want to build or fix.
              </div>
            ) : (
              messages.map((m) => <MessageView key={m.id} message={m} />)
            )}
          </div>

          <div className="composer">
            <textarea
              value={input}
              placeholder={running ? 'Working…' : 'Ask the agent to do something (e.g. "create a Python hello world and run it")'}
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
          <div className="bubble">{message.content}</div>
        </>
      )}
      {message.toolCalls?.map((call) => {
        const result = message.toolResults?.find((r) => r.id === call.id)
        return (
          <div className="toolcard" key={call.id}>
            <div className="th">
              <span>🔧 {call.name}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {result ? (
                <span className={result.ok ? 'ok' : 'bad'}>{result.ok ? 'ok' : 'error'}</span>
              ) : (
                <span className="bad">running…</span>
              )}
            </div>
            <pre>{JSON.stringify(call.args, null, 2)}</pre>
            {result && <pre>{result.output}</pre>}
          </div>
        )
      })}
    </div>
  )
}

