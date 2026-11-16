# Start the ThinkingOut server automatically when Windows starts.
#
# Run once, in PowerShell opened as administrator, from the project folder
# (the one with README.md and the server folder in it):
#
#   powershell -ExecutionPolicy Bypass -File server\autostart-windows.ps1 -Model gemma4:e2b
#
# It creates start-server.cmd next to this script and a scheduled task,
# "ThinkingOut server", that runs it at startup, hidden, as you (no password
# stored), restarting it if it stops. Output goes to server\data\server.log.
# To remove it: Unregister-ScheduledTask -TaskName "ThinkingOut server"

param([string]$Model = "gemma4:e2b")

$ErrorActionPreference = "Stop"
$server = $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js isn't installed (or this window was opened before it was). Install it, open a new PowerShell as administrator, and run this again." }

New-Item -ItemType Directory -Force (Join-Path $server "data") | Out-Null

# A small launcher, so the task needs no tricky quoting.
$launcher = Join-Path $server "start-server.cmd"
@"
@echo off
cd /d "%~dp0.."
set OLLAMA_MODEL=$Model
"$node" server\server.mjs >> server\data\server.log 2>&1
"@ | Set-Content -Encoding ASCII $launcher

$action = New-ScheduledTaskAction -Execute $launcher
$trigger = New-ScheduledTaskTrigger -AtStartup
# S4U: runs as you, in the background, without storing your password.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "ThinkingOut server" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "ThinkingOut server"

Write-Host ""
Write-Host "Done. The ThinkingOut server now starts with Windows (model: $Model)."
Write-Host "It's running now too. Check: open http://localhost:8787 in a browser."
Write-Host "Log: $(Join-Path $server 'data\server.log')"
