$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

$docker = $null
$cmd = Get-Command docker -ErrorAction SilentlyContinue
if ($cmd) { $docker = $cmd.Source }
if (-not $docker) {
  $candidate = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
  if (Test-Path $candidate) { $docker = $candidate }
}
if (-not $docker) {
  Write-Output 'DOCKER_NOT_FOUND'
  exit 1
}

$deadline = (Get-Date).AddMinutes(2)
$announced = $false
while ((Get-Date) -lt $deadline) {
  # Read the whole command. Piping into Select-Object -First 1 closes the pipe early
  # and makes docker.exe exit with a broken-pipe status.
  $idText = & $docker compose ps -q postgres 2>&1 | Out-String
  $code = $LASTEXITCODE
  $id = ($idText -split '\r?\n' | Where-Object { $_ -match '^[0-9a-fA-F]+$' } | Select-Object -First 1)
  if ($code -ne 0 -or -not $id) {
    if ($code -ne 0 -and -not $announced) {
      Write-Output 'DOCKER_NOT_READY'
      $announced = $true
    } else {
      Write-Output 'waiting postgres... container not found'
    }
  } else {
    $status = & $docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id
    if ($status -eq 'healthy') {
      Write-Output 'POSTGRES_HEALTHY'
      exit 0
    }
    Write-Output "waiting postgres... status=$status"
  }
  Start-Sleep -Seconds 3
}
Write-Output 'POSTGRES_TIMEOUT'
exit 1
