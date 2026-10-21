param([string]$ToolsDirectory = 'D:\WeChat MP Tools')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ToolsDirectory -PathType Container)) { throw 'MP Tools directory is missing.' }
$shellPath = (Get-Command pwsh -ErrorAction Stop).Source
foreach ($entry in @(
    @{ Name = '启动 CampusOS 同步.cmd'; Script = 'start.ps1' },
    @{ Name = '停止 CampusOS 同步.cmd'; Script = 'stop.ps1' }
)) {
    $scriptPath = Join-Path $PSScriptRoot $entry.Script
    $content = "@echo off`r`nchcp 65001 >nul`r`n`"$shellPath`" -NoProfile -File `"$scriptPath`"`r`npause`r`n"
    [System.IO.File]::WriteAllText((Join-Path $ToolsDirectory $entry.Name), $content, [System.Text.UTF8Encoding]::new($false))
}
Write-Output 'CampusOS start/stop launchers installed. No process or upstream task was started.'
