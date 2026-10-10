# Claude Code GUI

A free, easy-to-install desktop GUI for **agentic coding** on Windows. It wraps the
official **Claude Code CLI** (uses your own Claude account) *or* **free backends**
(Ollama local models / OpenRouter free tier) — all behind a simple chat UI with a
settings panel.

![platform](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/electron-33-47848f) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- 🖥️ **GUI chat** for an autonomous coding agent (no terminal required).
- 🔀 **Backend switcher**: Claude Code CLI, Ollama (free/local), or OpenRouter (free tier).
- 🛠️ **Real agentic tools**: `read_file`, `write_file`, `list_dir`, `run_command` — sandboxed to your chosen project folder.
- 👀 **Live tool cards** showing exactly what the agent reads, writes, and runs.
- 🛡️ **Approval gate + diff preview**: before any file write or shell command, you get a confirm dialog with a unified diff — deny to stop it.
- 🔴 **Live streaming shell output**: watch builds, tests, and commands run in real time, with a pulsing "running…" indicator.
- 📝 **Markdown rendering**: agent replies render code blocks (with copy buttons), lists, headings, and formatting.
- 💬 **Multi-turn memory** — the agent remembers the conversation; chats **persist** across restarts, with a **＋ New Chat** button to reset.
- ⚙️ **Settings panel** to pick backend, model, API key, Ollama URL, and working directory.
- 📦 **Windows installer** (`.exe`) and portable build via electron-builder.
- 🚀 **Fork & push ready**: GitHub Actions build on every push, release on tags.

## Quick start (Windows, from source)

```powershell
# 1. Install Node.js 20+ from https://nodejs.org
# 2. In this folder:
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\install.ps1

# 3. Run in dev mode:
npm run dev
```

## One-liner

```powershell
git clone https://github.com/<you>/claude-code-gui.git; cd claude-code-gui; Set-ExecutionPolicy -Scope Process Bypass -Force; .\scripts\install.ps1; npm run dev
```

## Choosing a backend

| Backend | Cost | What you need |
| --- | --- | --- |
| **Claude Code CLI** | Your Claude plan / API usage | `npm i -g @anthropic-ai/claude-code`, then log in |
| **Ollama** (local) | Free | Install [Ollama](https://ollama.com), then `ollama pull qwen2.5-coder:7b` |
| **OpenRouter** (free tier) | Free tier available | A free API key from [openrouter.ai](https://openrouter.ai) |

Open **⚙ Settings** in the app to switch backends and configure them.

## Building the Windows installer

```powershell
npm run dist:win        # NSIS installer + portable exe in ./release
npm run dist:portable   # just the portable exe
```

## Fork & push (CI/CD)

- **On every push / PR**: `.github/workflows/build.yml` builds and packages a portable `.exe`.
- **On tag `v*.*.*`**: `.github/workflows/release.yml` builds the NSIS installer + portable exe and publishes a GitHub Release.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Security notes

- File/command tools are restricted to the **working directory** you set; paths that escape it are rejected.
- With **Auto-approve** off (default), every file write and shell command shows an **approval dialog with a diff preview** first. The Claude Code toggle maps to `--dangerously-skip-permissions`. Only enable auto-approve on projects you trust.
- API keys are stored locally in your OS user-data folder via `electron-store`. Never commit them.

## Project layout

```
src/
  main/            Electron main process (window, IPC, settings store)
  preload/         Secure context bridge (window.api)
  renderer/        React GUI (chat + settings panel)
  agent/           Agent orchestrator + pluggable backends + tools
    backends/      claude-code / ollama / openrouter
    tools.ts       read_file, write_file, list_dir, run_command
  shared/          Shared types & defaults
scripts/           install.ps1 (Windows setup)
.github/workflows  build.yml (push) + release.yml (tags)
```

## License

MIT
