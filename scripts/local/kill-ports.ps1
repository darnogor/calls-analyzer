# Stop pid files written when this project starts local processes.
# Other listeners on the same ports are left running.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pidDir = Join-Path $root '.local\pids'

if (-not (Test-Path $pidDir)) {
  Write-Output 'no project pids'
  exit 0
}

function Test-ProjectProcess([string]$command) {
  if ($command -match 'scripts[\\/]local[\\/](run-service|dev-web)\.js') { return $true }
  if ($command -match 'seller-reviewer[\\/]apps[\\/][^\\/]+[\\/]dist[\\/]main\.js') { return $true }
  return $false
}

$files = @(Get-ChildItem -Path $pidDir -Filter '*.pid' -ErrorAction SilentlyContinue)
if ($files.Count -eq 0) {
  Write-Output 'no project pids'
  exit 0
}

foreach ($file in $files) {
  $keep = $false
  $lines = @(Get-Content -Path $file.FullName -ErrorAction SilentlyContinue)
  foreach ($line in $lines) {
    $trimmed = ([string]$line).Trim()
    if ($trimmed -notmatch '^\d+$') { continue }
    $procId = [int]$trimmed
    if ($procId -le 0 -or $procId -eq $PID) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $proc) {
      Write-Output "pid $procId already exited"
      continue
    }
    $command = [string]$proc.CommandLine
    if (-not (Test-ProjectProcess $command)) {
      Write-Output "skip pid $procId : not a project process"
      continue
    }
    Write-Output "stopping pid $procId"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    $still = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($still) {
      Write-Output "could not stop pid $procId"
      $keep = $true
    }
  }
  if (-not $keep) {
    Remove-Item -Path $file.FullName -Force -ErrorAction SilentlyContinue
  }
}

Write-Output 'project processes stopped'
