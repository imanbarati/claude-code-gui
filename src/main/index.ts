import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as fs from 'node:fs'
import Store from 'electron-store'
import { IPC, DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, RunRequest, AgentEvent, ChatMessage, Conversation, ConversationSummary, ApprovalDecision, ToolPreview, ToolCall } from '@shared/types'
import type { ChatTurn } from '../agent/backends/types'
import { getBackend, listModels } from '../agent/orchestrator'
import { expandMentions, extractMentions } from '../agent/context'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface StoreSchema {
  settings: Settings
  conversations: Conversation[]
  activeId: string
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function newConversation(): Conversation {
  const now = Date.now()
  return { id: makeId('conv'), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}

const store = new Store<StoreSchema>({
  name: 'claude-code-gui',
  defaults: { settings: DEFAULT_SETTINGS, conversations: [], activeId: '' }
})

// One-time migration: ensure at least one conversation + a valid activeId.
function ensureConversations(): void {
  let convs = store.get('conversations') ?? []
  if (!Array.isArray(convs) || convs.length === 0) {
    convs = [newConversation()]
    store.set('conversations', convs)
  }
  const activeId = store.get('activeId')
  if (!activeId || !convs.some((c) => c.id === activeId)) {
    store.set('activeId', convs[0].id)
  }
}

function getConversations(): Conversation[] {
  ensureConversations()
  return store.get('conversations')
}

function getActiveId(): string {
  ensureConversations()
  return store.get('activeId')
}

function getActiveConversation(): Conversation {
  const convs = getConversations()
  const id = getActiveId()
  return convs.find((c) => c.id === id) ?? convs[0]
}

function updateActive(updater: (c: Conversation) => Conversation): Conversation {
  const convs = getConversations()
  const id = getActiveId()
  const idx = convs.findIndex((c) => c.id === id)
  const updated = updater(convs[idx])
  updated.updatedAt = Date.now()
  // Derive a title from the first user message if still default.
  if (updated.title === 'New chat' || !updated.title.trim()) {
    const firstUser = updated.messages.find((m) => m.role === 'user')
    if (firstUser) updated.title = firstUser.content.slice(0, 48) || 'New chat'
  }
  convs[idx] = updated
  store.set('conversations', convs)
  return updated
}

// Derive a title from the first user message.
function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'New chat'
  const t = firstUser.content.trim().replace(/\s+/g, ' ')
  return t.length > 48 ? t.slice(0, 48) + '…' : t || 'New chat'
}

let mainWindow: BrowserWindow | null = null
let currentAbort: AbortController | null = null

// In-memory conversation history shared across turns of a session.
let historyTurns: ChatTurn[] = []
let activeConversationId: string | null = null

// Pending approval prompts keyed by tool-call id.
const pendingApprovals = new Map<string, (approved: boolean) => void>()

const APP_ROOT = app.getAppPath()

// Convert stored chat messages into backend ChatTurns (user + assistant text only).
function turnsFromMessages(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const m of messages) {
    if (m.role === 'user' && m.content.trim()) {
      turns.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant' && m.content.trim()) {
      turns.push({ role: 'assistant', content: m.content })
    }
  }
  return turns
}

function resolveHtml(): string {
  return path.join(__dirname, '../renderer/index.html')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#0f1117',
    show: false,
    autoHideMenuBar: true,
    title: 'Claude Code GUI',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(resolveHtml())
  }

  // Open external links in the OS browser, not the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    import('electron').then(({ shell }) => shell.openExternal(url))
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function sendToRenderer(event: AgentEvent): void {
  mainWindow?.webContents.send(IPC.agentEvent, event)
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => store.get('settings'))

  ipcMain.handle(IPC.setSettings, (_e, next: Settings) => {
    store.set('settings', next)
    return next
  })

  ipcMain.handle(IPC.pickWorkdir, async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Choose your project folder'
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.listOllamaModels, async (_e, settings: Settings) => {
    return listModels(settings)
  })

  ipcMain.handle(IPC.getConversation, (): Conversation => getActiveConversation())

  ipcMain.handle(IPC.setConversation, (_e, conv: { messages: ChatMessage[] }) => {
    const updated = updateActive((c) => ({ ...c, messages: conv.messages, title: c.title }))
    historyTurns = turnsFromMessages(updated.messages)
    return updated
  })

  ipcMain.handle(IPC.clearConversation, () => {
    updateActive((c) => ({ ...c, messages: [], title: 'New chat' }))
    historyTurns = []
  })

  // --- Multi-conversation management ---
  ipcMain.handle(IPC.listConversations, (): ConversationSummary[] => {
    return getConversations()
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

  ipcMain.handle(IPC.newConversation, (): Conversation => {
    const conv = newConversation()
    const convs = getConversations()
    convs.unshift(conv)
    store.set('conversations', convs)
    store.set('activeId', conv.id)
    historyTurns = []
    activeConversationId = conv.id
    return conv
  })

  ipcMain.handle(IPC.selectConversation, (_e, id: string): Conversation | null => {
    const convs = getConversations()
    const conv = convs.find((c) => c.id === id)
    if (!conv) return null
    store.set('activeId', id)
    historyTurns = turnsFromMessages(conv.messages)
    activeConversationId = id
    return conv
  })

  ipcMain.handle(IPC.deleteConversation, (_e, id: string): Conversation => {
    let convs = getConversations()
    convs = convs.filter((c) => c.id !== id)
    if (convs.length === 0) convs = [newConversation()]
    store.set('conversations', convs)
    // If we deleted the active one, switch to the most recent remaining.
    if (store.get('activeId') === id) {
      const next = convs.sort((a, b) => b.updatedAt - a.updatedAt)[0]
      store.set('activeId', next.id)
      historyTurns = turnsFromMessages(next.messages)
      activeConversationId = next.id
      return next
    }
    return getActiveConversation()
  })

  ipcMain.handle(IPC.cancelAgent, () => {
    currentAbort?.abort()
    currentAbort = null
    // Resolve any pending approvals as denied so the backend can unwind.
    for (const [, resolve] of pendingApprovals) resolve(false)
    pendingApprovals.clear()
  })

  ipcMain.handle(IPC.approveTool, (_e, decision: ApprovalDecision) => {
    const resolve = pendingApprovals.get(decision.callId)
    if (resolve) {
      resolve(decision.approved)
      pendingApprovals.delete(decision.callId)
    }
  })

  ipcMain.handle(IPC.runAgent, async (_e, req: RunRequest) => {
    if (currentAbort) currentAbort.abort()
    currentAbort = new AbortController()
    const abort = currentAbort

    // Ask the user to approve a mutating tool; resolves via IPC.
    const requestApproval = (call: ToolCall, preview: ToolPreview): Promise<boolean> => {
      sendToRenderer({ type: 'tool_approval', call, preview })
      return new Promise<boolean>((resolve) => {
        pendingApprovals.set(call.id, resolve)
        // If aborted while waiting, deny.
        abort.signal.addEventListener(
          'abort',
          () => {
            if (pendingApprovals.has(call.id)) {
              pendingApprovals.delete(call.id)
              resolve(false)
            }
          },
          { once: true }
        )
      })
    }

    // Seed in-memory history from the active conversation if empty.
    if (historyTurns.length === 0) {
      historyTurns = turnsFromMessages(getActiveConversation().messages)
    }
    const historySnapshot = [...historyTurns]

    // Expand @file mentions into context before sending to the backend.
    const workdir = req.settings.workdir || process.cwd()
    const expanded = expandMentions(req.prompt, { workdir })

    // Track the assistant's final text so we can append it to history.
    let assistantText = ''

    try {
      await getBackend(req.settings.backend).run({
        settings: req.settings,
        history: historySnapshot,
        prompt: expanded.prompt,
        onEvent: (event) => {
          if (event.type === 'assistant_message') assistantText = event.message.content
          if (event.type === 'assistant_delta') assistantText += event.text
          sendToRenderer(event)
        },
        signal: abort.signal,
        requestApproval
      })
    } catch (e: any) {
      sendToRenderer({ type: 'error', message: e?.message ?? String(e) })
      sendToRenderer({ type: 'done' })
    } finally {
      // Persist this turn into history for multi-turn context.
      if (req.prompt.trim()) historyTurns.push({ role: 'user', content: req.prompt })
      if (assistantText.trim()) historyTurns.push({ role: 'assistant', content: assistantText })
      for (const [, resolve] of pendingApprovals) resolve(false)
      pendingApprovals.clear()
      if (currentAbort === abort) currentAbort = null
    }
  })

  // Preview which @file mentions exist (for chips in the composer).
  ipcMain.handle('agent:previewMentions', (_e, prompt: string, workdir: string) => {
    return extractMentions(prompt).map((rel) => {
      const abs = path.resolve(workdir || process.cwd(), rel)
      let exists = false
      try {
        exists = fs.existsSync(abs) && fs.statSync(abs).isFile()
      } catch {
        exists = false
      }
      return { path: rel, exists }
    })
  })

  // Export the active conversation to a Markdown file chosen by the user.
  ipcMain.handle(IPC.exportChat, async () => {
    if (!mainWindow) return null
    const conv = getActiveConversation()
    const md = conversationToMarkdown(conv.messages)
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export chat',
      defaultPath: 'claude-code-chat.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return null
    fs.writeFileSync(res.filePath, md, 'utf8')
    return res.filePath
  })
}

// Render the conversation as Markdown for export.
function conversationToMarkdown(messages: ChatMessage[]): string {
  const lines: string[] = ['# Claude Code GUI — Chat Export', '', `_Exported ${new Date().toLocaleString()}_`, '']
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push('## 🧑 You', '', m.content, '')
    } else if (m.role === 'assistant') {
      if (m.content) lines.push('## 🤖 Agent', '', m.content, '')
      for (const call of m.toolCalls ?? []) {
        const result = m.toolResults?.find((r) => r.id === call.id)
        lines.push(`**🔧 Tool: \`${call.name}\`**`, '', '```json', JSON.stringify(call.args, null, 2), '```')
        if (result) {
          lines.push('', `_${result.ok ? '✓ ok' : '✗ error'}_`, '', '```', result.output, '```')
        }
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Silence noisy GPU cache warnings on Windows.
app.commandLine.appendSwitch('disable-gpu')

void APP_ROOT
