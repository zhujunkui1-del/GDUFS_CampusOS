param([string]$ConfigPath = 'D:\WeChat MP Tools_v2.3.1\data\CampusOS_collector\config.json')
$ErrorActionPreference = 'Stop'
$collectorScript = Join-Path $PSScriptRoot 'collector.py'
$processFile = Join-Path (Split-Path -Parent $ConfigPath) 'process.json'
if (-not (Test-Path -LiteralPath $processFile)) { return }
$record = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
$collectorProcessId = [int]$record.pid
$collectorProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $collectorProcessId)
if (-not $collectorProcess) { return }
if (-not ($collectorProcess.CommandLine.Contains($collectorScript) -and $collectorProcess.CommandLine.Contains($ConfigPath))) { throw 'Process identity differs; not stopping it.' }
Stop-Process -Id $collectorProcessId
Wait-Process -Id $collectorProcessId -Timeout 10 -ErrorAction SilentlyContinue
Write-Output ('Collector stopped: ' + $collectorProcessId)
