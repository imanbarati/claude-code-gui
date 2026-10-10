import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Store from 'electron-store'
import { IPC, DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, RunRequest, AgentEvent, ChatMessage, Conversation, ApprovalDecision, ToolPreview, ToolCall } from '@shared/types'
import type { ChatTurn } from '../agent/backends/types'
import { getBackend, listModels } from '../agent/orchestrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface StoreSchema {
  settings: Settings
  conversation: Conversation
}

const store = new Store<StoreSchema>({
  name: 'claude-code-gui',
  defaults: { settings: DEFAULT_SETTINGS, conversation: { messages: [] } }
})

let mainWindow: BrowserWindow | null = null
let currentAbort: AbortController | null = null

// In-memory conversation history shared across turns of a session.
let historyTurns: ChatTurn[] = []

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

  ipcMain.handle(IPC.getConversation, (): Conversation => store.get('conversation'))

  ipcMain.handle(IPC.setConversation, (_e, conv: Conversation) => {
    store.set('conversation', conv)
    historyTurns = turnsFromMessages(conv.messages)
    return conv
  })

  ipcMain.handle(IPC.clearConversation, () => {
    store.set('conversation', { messages: [] })
    historyTurns = []
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

    // Seed in-memory history from persisted conversation if empty.
    if (historyTurns.length === 0) {
      historyTurns = turnsFromMessages(store.get('conversation').messages)
    }
    const historySnapshot = [...historyTurns]

    // Track the assistant's final text so we can append it to history.
    let assistantText = ''

    try {
      await getBackend(req.settings.backend).run({
        settings: req.settings,
        history: historySnapshot,
        prompt: req.prompt,
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
