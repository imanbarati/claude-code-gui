# One-line install for Claude Code GUI (developer / source setup) on Windows.
# Usage (from the repo folder):
#   Set-ExecutionPolicy -Scope Process Bypass -Force; .\scripts\install.ps1
#
# This installs Node dependencies and (optionally) the free AI backends.

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

Write-Step "Checking prerequisites..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found. Install Node 20+ from https://nodejs.org and re-run."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm not found. It ships with Node.js. Reinstall Node and try again."
}

$nodeVersion = (node --version)
Write-Host "   Node $nodeVersion, npm $(npm --version)"

Write-Step "Installing project dependencies..."
npm install

Write-Step "Installing optional Claude Code CLI (uses your Claude account)?"
$installClaude = Read-Host "Install Claude Code CLI globally? (y/N)"
if ($installClaude -match '^[Yy]') {
  npm install -g @anthropic-ai/claude-code
}

Write-Step "Installing optional local free backend (Ollama)?"
$installOllama = Read-Host "Install Ollama for free local models? (y/N)"
if ($installOllama -match '^[Yy]') {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
  } else {
    Write-Host "   winget not found. Download Ollama from https://ollama.com/download/windows" -ForegroundColor Yellow
  }
}

Write-Step "Done. Start the app in dev mode with:  npm run dev"
Write-Host ""
Write-Host "To build a Windows installer (.exe) later:  npm run dist:win" -ForegroundColor Green
