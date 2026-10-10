import { useEffect, useState } from 'react'
import type { Settings, BackendId } from '@shared/types'

interface Props {
  settings: Settings
  onChange: (next: Settings) => void
}

const BACKENDS: Array<{ id: BackendId; label: string; free: boolean; note: string }> = [
  { id: 'claude-code', label: 'Claude Code CLI', free: false, note: 'Official CLI. Uses your Claude login or ANTHROPIC_API_KEY. npm i -g @anthropic-ai/claude-code' },
  { id: 'ollama', label: 'Ollama (local)', free: true, note: 'Runs free models locally. Install Ollama + a coding model, e.g. qwen2.5-coder.' },
  { id: 'openrouter', label: 'OpenRouter (free tier)', free: true, note: 'Free models via OpenRouter. Needs a free API key from openrouter.ai.' }
]

export function SettingsPanel({ settings, onChange }: Props): JSX.Element {
  const [models, setModels] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState<string>('')

  useEffect(() => {
    if (settings.backend === 'ollama') {
      setModelStatus('loading…')
      window.api
        .listOllamaModels(settings)
        .then((m) => {
          setModels(m)
          setModelStatus(m.length ? `${m.length} models` : 'no models found')
        })
        .catch((e: unknown) => {
          setModels([])
          setModelStatus(e instanceof Error ? e.message : 'failed')
        })
    } else {
      setModels([])
      setModelStatus('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.backend, settings.ollamaUrl])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    onChange({ ...settings, [key]: value })

  const current = BACKENDS.find((b) => b.id === settings.backend)!

  return (
    <aside className="drawer">
      <h2>Settings</h2>

      <div className="field">
        <label>AI Backend</label>
        <select
          value={settings.backend}
          onChange={(e) => set('backend', e.target.value as BackendId)}
        >
          {BACKENDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} {b.free ? '(free)' : ''}
            </option>
          ))}
        </select>
        <div className="hint">{current.note}</div>
      </div>

      <div className="section-title">Project</div>
      <div className="field">
        <label>Working directory</label>
        <div className="row">
          <input
            value={settings.workdir}
            placeholder="C:\\path\\to\\your\\project"
            onChange={(e) => set('workdir', e.target.value)}
          />
          <button
            className="btn"
            onClick={() => {
              window.api.pickWorkdir().then((p) => {
                if (p) set('workdir', p)
              })
            }}
          >
            Browse…
          </button>
        </div>
        <div className="hint">All file/command tools are restricted to this folder.</div>
      </div>

      {settings.backend === 'claude-code' && (
        <>
          <div className="section-title">Claude Code</div>
          <div className="field">
            <label>CLI command</label>
            <input value={settings.claudeCommand} onChange={(e) => set('claudeCommand', e.target.value)} />
            <div className="hint">Install: npm i -g @anthropic-ai/claude-code</div>
          </div>
          <div className="field check">
            <input
              id="auto"
              type="checkbox"
              checked={settings.autoApproveTools}
              onChange={(e) => set('autoApproveTools', e.target.checked)}
            />
            <label htmlFor="auto">Auto-approve tool use (skip permissions)</label>
          </div>
        </>
      )}

      {settings.backend === 'ollama' && (
        <>
          <div className="section-title">Ollama <span className="badge free">free</span></div>
          <div className="field">
            <label>Server URL</label>
            <input value={settings.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} />
          </div>
          <div className="field">
            <label>Model {modelStatus && <span className="badge">{modelStatus}</span>}</label>
            <input
              list="ollama-models"
              value={settings.ollamaModel}
              onChange={(e) => set('ollamaModel', e.target.value)}
            />
            <datalist id="ollama-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="hint">Try: ollama pull qwen2.5-coder:7b</div>
          </div>
        </>
      )}

      {settings.backend === 'openrouter' && (
        <>
          <div className="section-title">OpenRouter <span className="badge free">free tier</span></div>
          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              value={settings.openRouterKey}
              placeholder="sk-or-..."
              onChange={(e) => set('openRouterKey', e.target.value)}
            />
            <div className="hint">Get a free key at openrouter.ai</div>
          </div>
          <div className="field">
            <label>Model</label>
            <input value={settings.openRouterModel} onChange={(e) => set('openRouterModel', e.target.value)} />
            <div className="hint">Free option: qwen/qwen3-coder:free</div>
          </div>
        </>
      )}

      <div className="section-title">Agent</div>
      <div className="field">
        <label>Max steps</label>
        <input
          type="number"
          min={1}
          max={50}
          value={settings.maxSteps}
          onChange={(e) => set('maxSteps', Number(e.target.value) || 1)}
        />
        <div className="hint">Safety limit for tool-use loops (Ollama/OpenRouter).</div>
      </div>
    </aside>
  )
}

