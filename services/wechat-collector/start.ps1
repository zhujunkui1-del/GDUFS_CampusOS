param([string]$ConfigPath = 'D:\WeChat MP Tools_v2.3.1\data\CampusOS_collector\config.json')
$ErrorActionPreference = 'Stop'
$collectorScript = Join-Path $PSScriptRoot 'collector.py'
$collectorData = Split-Path -Parent $ConfigPath
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Configure the collector in CampusOS first.' }
$processFile = Join-Path $collectorData 'process.json'
if (Test-Path -LiteralPath $processFile) {
    $previousProcess = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
    $existingProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$previousProcess.pid)
    if ($existingProcess -and $existingProcess.CommandLine.Contains($collectorScript) -and $existingProcess.CommandLine.Contains($ConfigPath)) {
        Write-Output ('Collector is already running: ' + $previousProcess.pid)
        return
    }
}
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$collectorArgs = '-X utf8 "{0}" --config "{1}" --watch' -f $collectorScript, $ConfigPath
$collectorProcess = Start-Process -FilePath $pythonPath -ArgumentList $collectorArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $collectorData 'worker.stdout.log') -RedirectStandardError (Join-Path $collectorData 'worker.stderr.log') -PassThru
Start-Sleep -Milliseconds 500
if ($collectorProcess.HasExited) { throw 'Collector did not start; check worker.stderr.log in the configured data directory.' }
@{ pid = $collectorProcess.Id; startedAt = (Get-Date).ToUniversalTime().ToString('o'); script = $collectorScript } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $collectorData 'process.json') -Encoding utf8
Write-Output ('Collector process started: ' + $collectorProcess.Id)
