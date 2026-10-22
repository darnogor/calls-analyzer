$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ports = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($port in 3000, 3001, 3002, 3003, 3100) {
  [void]$ports.Add($port)
}

$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  $envFile = Join-Path $root '.env.example'
}
if (Test-Path $envFile) {
  foreach ($line in Get-Content -Path $envFile) {
    if ($line -match '^(API_PORT|MEDIA_PORT|TRANSCRIBER_PORT|ANALYZER_PORT|WEB_PORT)=(\d+)\s*$') {
      [void]$ports.Add([int]$Matches[2])
    }
  }
}

foreach ($port in $ports) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Write-Output "killing pid $($_.OwningProcess) on $port"
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Write-Output 'ports cleared'
