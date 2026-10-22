$ErrorActionPreference = 'Stop'
try {
  $root = Split-Path $PSScriptRoot -Parent
  Set-Location -LiteralPath $root
  $runtime = Join-Path $root '.runtime'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $version = 'v24.17.0'
  $name = "node-$version-win-$arch"
  $node = Join-Path $runtime "$name/node.exe"
  if (!(Test-Path -LiteralPath $node)) {
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    Write-Host 'Downloading private Node.js runtime from nodejs.org ...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $runtime "$name.zip"
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/$name.zip" -OutFile $zip
    $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/SHASUMS256.txt").Content
    $line = ($sums -split "`n" | Where-Object { $_.Trim().EndsWith("  $name.zip") })
    if (!$line) { throw 'Checksum entry missing.' }
    $expected = ($line.Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) { throw 'Node.js checksum mismatch.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force
  }
  $env:PATH = "$(Split-Path $node -Parent);$env:PATH"
  & $node (Join-Path $PSScriptRoot 'launch.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Setup failed. See the message above.' }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
