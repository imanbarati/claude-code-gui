import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Store from 'electron-store'
import { IPC, DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, RunRequest, AgentEvent } from '@shared/types'
import { getBackend, listModels } from '../agent/orchestrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const store = new Store<{ settings: Settings }>({
  name: 'claude-code-gui',
  defaults: { settings: DEFAULT_SETTINGS }
})

let mainWindow: BrowserWindow | null = null
let currentAbort: AbortController | null = null

const APP_ROOT = app.getAppPath()

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

  ipcMain.handle(IPC.cancelAgent, () => {
    currentAbort?.abort()
    currentAbort = null
  })

  ipcMain.handle(IPC.runAgent, async (_e, req: RunRequest) => {
    if (currentAbort) currentAbort.abort()
    currentAbort = new AbortController()
    const abort = currentAbort

    // Lightweight conversation history (extend as needed).
    const history: Array<{ role: any; content: string }> = []

    try {
      await getBackend(req.settings.backend).run({
        settings: req.settings,
        history,
        prompt: req.prompt,
        onEvent: sendToRenderer,
        signal: abort.signal
      })
    } catch (e: any) {
      sendToRenderer({ type: 'error', message: e?.message ?? String(e) })
      sendToRenderer({ type: 'done' })
    } finally {
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
