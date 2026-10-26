$ErrorActionPreference='Stop'
$searchRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$searchRuntime=Join-Path $PSScriptRoot 'runtime'
$searchNode=(Get-Command node).Source
foreach($searchEntry in @('server','runner')){
  $searchScript=Join-Path $PSScriptRoot ($searchEntry+'.mjs')
  $searchExisting=Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($searchScript) }
  if($searchExisting){Write-Output ($searchEntry+' already running: '+$searchExisting.ProcessId);continue}
  $searchProcess=Start-Process -FilePath $searchNode -ArgumentList @('"'+$searchScript+'"') -WorkingDirectory $searchRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $searchRuntime ($searchEntry+'-background.log')) -RedirectStandardError (Join-Path $searchRuntime ($searchEntry+'-background-error.log')) -PassThru
  Write-Output ($searchEntry+' started: '+$searchProcess.Id)
}
