$ErrorActionPreference = 'SilentlyContinue'
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = 'http://localhost:5173'

function Test-ShortFlowPort {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-ShortFlowPort -Port 5173)) {
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/k', 'title ShortFlow Studio && npm run dev' `
    -WorkingDirectory $projectPath `
    -WindowStyle Minimized

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Test-ShortFlowPort -Port 5173) { break }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $appUrl
