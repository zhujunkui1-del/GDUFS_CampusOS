param([string]$ToolsDirectory = 'D:\WeChat MP Tools_v2.3.1', [switch]$AutoStart)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ToolsDirectory -PathType Container)) { throw 'MP Tools directory is missing.' }
$shellPath = (Get-Command pwsh -ErrorAction Stop).Source
foreach ($entry in @(
    @{ Name = '启动 CampusOS 同步.cmd'; Script = 'start.ps1' },
    @{ Name = '停止 CampusOS 同步.cmd'; Script = 'stop.ps1' }
)) {
    $scriptPath = Join-Path $PSScriptRoot $entry.Script
    $content = "@echo off`r`nchcp 65001 >nul`r`n`"$shellPath`" -NoProfile -File `"$scriptPath`" -ConfigPath `"%~dp0data\CampusOS_collector\config.json`"`r`npause`r`n"
    [System.IO.File]::WriteAllText((Join-Path $ToolsDirectory $entry.Name), $content, [System.Text.UTF8Encoding]::new($false))
}
if ($AutoStart) {
    $configPath = Join-Path $ToolsDirectory 'data\CampusOS_collector\config.json'
    $startScript = Join-Path $PSScriptRoot 'start.ps1'
    $action = New-ScheduledTaskAction -Execute $shellPath -Argument ('-NoProfile -WindowStyle Hidden -File "' + $startScript + '" -ConfigPath "' + $configPath + '"')
    $userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
    $principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName 'CampusOS-WeChat-SharedLibrary' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Import completed local WeRSS articles and add/update CampusOS from the shared MP Tools library.' -Force | Out-Null
}
Write-Output 'CampusOS start/stop launchers installed for this MP Tools directory.'
