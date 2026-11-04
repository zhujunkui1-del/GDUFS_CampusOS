# Read-only connectivity comparison. Run on campus, then on another network.
# No admin rights, DNS/proxy changes, login, cookies or packet capture.
[CmdletBinding()]
param(
  [ValidateSet('campus', 'outside', 'unknown')]
  [string]$Label = 'unknown',
  [string]$OutputDirectory = (Join-Path (Get-Location) 'CampusOS-network-report'),
  [switch]$SkipPublicDns
)
$ErrorActionPreference = 'Stop'
$targets = @('gdufs.ccwu.cc', 'map-test.gdufs.ccwu.cc')
$controls = @('www.gdufs.edu.cn', 'www.qq.com')
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw 'curl.exe is required (Windows 10/11). No software has been installed.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$reportRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$proxy = Get-ItemProperty -LiteralPath 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings' -ErrorAction SilentlyContinue
$report = [ordered]@{
  schema = 1
  label = $Label
  at = [DateTime]::UtcNow.ToString('o')
  note = 'Read-only public-site probes. curl bypasses environment HTTP proxies; transparent VPN/TUN may still affect results. No local/client IP, SSID, username, cookies or credentials collected.'
  proxyHints = @{
    browserProxyEnabled = [bool]$proxy.ProxyEnable
    browserPacPresent = [bool]$proxy.AutoConfigURL
    environmentProxyPresent = [bool]($env:HTTP_PROXY -or $env:HTTPS_PROXY -or $env:ALL_PROXY)
  }
  dns = @()
  https = @()
}
function Test-SyntheticAddress([string]$Address) {
  return $Address -match '^198\.(18|19)\.'
}
function Read-DnsResult([string]$Name, [string]$Type, [string]$Resolver) {
  $started = [Diagnostics.Stopwatch]::StartNew()
  try {
    $dnsArguments = @{ Name = $Name; Type = $Type; DnsOnly = $true; NoHostsFile = $true; QuickTimeout = $true; ErrorAction = 'Stop' }
    if ($Resolver -ne 'system') { $dnsArguments.Server = $Resolver }
    $answer = @(Resolve-DnsName @dnsArguments)
    $addresses = @($answer | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress -Unique)
    return [ordered]@{ host = $Name; type = $Type; resolver = $Resolver; addresses = $addresses; synthetic = @($addresses | Where-Object { Test-SyntheticAddress $_ }).Count -gt 0; ms = $started.ElapsedMilliseconds }
  } catch {
    return [ordered]@{ host = $Name; type = $Type; resolver = $Resolver; addresses = @(); error = $_.FullyQualifiedErrorId; ms = $started.ElapsedMilliseconds }
  }
}
function Read-Number([string]$Value) {
  $parsed = 0.0
  if ([double]::TryParse($Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) { return [Math]::Round($parsed * 1000, 1) }
  return $null
}
function Read-HttpsResult([string]$Name, [string]$Family) {
  $key = [Guid]::NewGuid().ToString('N')
  $headerFile = Join-Path $reportRoot ($key + '.headers.tmp')
  $errorFile = Join-Path $reportRoot ($key + '.errors.tmp')
  $uri = 'https://' + $Name + $(if ($targets -contains $Name) { '/map' } else { '/' })
  $arguments = @('--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '5', '--max-time', '10', '--output', 'NUL', '--dump-header', $headerFile, '--write-out', '%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{remote_ip}')
  if ($Family -eq 'ipv4') { $arguments += '--ipv4' }
  if ($Family -eq 'ipv6') { $arguments += '--ipv6' }
  try {
    # Native stderr is captured locally and only a bounded anonymous error is exported.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $curl.Source @arguments $uri 2> $errorFile
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    $fields = ([string]::Join('', @($output))).Trim().Split('|')
    $headers = if (Test-Path -LiteralPath $headerFile) { Get-Content -LiteralPath $headerFile -Raw } else { '' }
    if ($null -eq $headers) { $headers = '' }
    $safeHeaders = @{}
    foreach ($headerName in @('server', 'cf-ray', 'content-type', 'cache-control', 'location')) {
      $headerMatches = [regex]::Matches($headers, '(?im)^' + $headerName + ':\s*([^\r\n]+)')
      if (-not $headerMatches.Count) { continue }
      $value = $headerMatches[$headerMatches.Count - 1].Groups[1].Value.Trim()
      if ($headerName -eq 'location') {
        try { $location = [Uri]::new([Uri]$uri, $value); $value = $location.GetLeftPart([UriPartial]::Path) } catch { $value = '(unparsed redirect)' }
      }
      $safeHeaders[$headerName] = $value
    }
    $stage = switch ($exitCode) { 0 { 'http-response' } 6 { 'dns-failure' } 7 { 'connect-failure' } 28 { 'timeout' } 35 { 'tls-failure' } 60 { 'certificate-verification-failure' } 56 { 'connection-read-failure' } default { 'curl-failure' } }
    $row = [ordered]@{ host = $Name; family = $Family; curlExitCode = $exitCode; stage = $stage; headers = $safeHeaders }
    if ($fields.Count -eq 7) {
      $row.status = [int]$fields[0]
      $row.dnsMs = Read-Number $fields[1]
      $row.connectMs = Read-Number $fields[2]
      $row.tlsCompleteMs = Read-Number $fields[3]
      $row.ttfbMs = Read-Number $fields[4]
      $row.totalMs = Read-Number $fields[5]
      $row.remoteAddress = $fields[6] # Remote server only, never the device's address.
      $row.syntheticRemote = Test-SyntheticAddress $fields[6]
    }
    if ($exitCode -ne 0 -and (Test-Path -LiteralPath $errorFile)) {
      $message = (Get-Content -LiteralPath $errorFile -Raw).Trim()
      $nativeMessage = [regex]::Match($message, 'curl:\s*\(\d+\)[^\r\n]*').Value
      if ($nativeMessage) { $row.error = $nativeMessage.Substring(0, [Math]::Min(220, $nativeMessage.Length)) }
    }
    return $row
  } finally {
    foreach ($temporary in @($headerFile, $errorFile)) { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
  }
}
foreach ($name in $targets) {
  Write-Host ('DNS: ' + $name)
  foreach ($type in @('A', 'AAAA')) { $report.dns += Read-DnsResult $name $type 'system' }
  if (-not $SkipPublicDns) {
    foreach ($resolver in @('223.5.5.5', '119.29.29.29')) { $report.dns += Read-DnsResult $name 'A' $resolver }
  }
}
foreach ($name in $targets) {
  foreach ($family in @('auto', 'ipv4', 'ipv6')) {
    Write-Host ('HTTPS: ' + $name + ' [' + $family + ']')
    $report.https += Read-HttpsResult $name $family
  }
}
foreach ($name in $controls) {
  Write-Host ('Control: ' + $name)
  $report.https += Read-HttpsResult $name 'auto'
}
$jsonPath = Join-Path $reportRoot ($Label + '.json')
$textPath = Join-Path $reportRoot ($Label + '.txt')
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
$summary = @('CampusOS public connectivity check', ('Network label: ' + $Label), ('UTC: ' + $report.at), '')
foreach ($row in $report.dns) { $summary += 'DNS ' + $row.host + ' ' + $row.type + ' resolver=' + $row.resolver + ' addresses=' + ($row.addresses -join ',') + $(if ($row.error) { ' error=' + $row.error } else { '' }) }
foreach ($row in $report.https) { $summary += 'HTTPS ' + $row.host + ' ' + $row.family + ' exit=' + $row.curlExitCode + ' status=' + $row.status + ' stage=' + $row.stage + ' ms=' + $row.totalMs + $(if ($row.headers['cf-ray']) { ' ray=' + $row.headers['cf-ray'] } else { '' }) }
$summary += @('', 'No system/network settings were changed. This report does not prove a campus block unless it was collected on the campus network.')
$summary | Set-Content -LiteralPath $textPath -Encoding UTF8
$summary | ForEach-Object { Write-Host $_ }
Write-Host ('Saved: ' + $textPath)
