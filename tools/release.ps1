#Requires -Version 5.1

[CmdletBinding()]
param(
  [string]$OutputPath = "ClassGrab.zip",
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageRoots = @("icons", "scripts", "styles", "views", "_locales", "manifest.json")
$VersionPattern = "\d+(?:\.\d+){1,3}"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  Write-Host "==> $Command $($Arguments -join ' ')"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
  }
}

function Normalize-ZipPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return (($Path -replace "\\", "/") -replace "^\./", "")
}

function Get-RequiredRegexVersions {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $matches = [regex]::Matches($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if ($matches.Count -eq 0) {
    throw "Could not find $Label."
  }

  return @($matches | ForEach-Object { $_.Groups[1].Value })
}

function Assert-AllVersionsMatch {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$Versions,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  $mismatches = @($Versions | Where-Object { $_ -ne $ExpectedVersion } | Sort-Object -Unique)
  if ($mismatches.Count -gt 0) {
    throw "$Label version mismatch. Expected $ExpectedVersion; found $($mismatches -join ', ')."
  }
}

function Assert-VersionSync {
  $manifestPath = Join-Path $RepoRoot "manifest.json"
  $popupPath = Join-Path $RepoRoot "views/popup.html"
  $readmePath = Join-Path $RepoRoot "README.md"

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifestVersion = [string]$manifest.version
  if ($manifestVersion -notmatch "^$VersionPattern$") {
    throw "manifest.json version '$manifestVersion' is not a Chrome-compatible dotted numeric version."
  }

  $popupHtml = Get-Content -LiteralPath $popupPath -Raw
  $popupVersions = Get-RequiredRegexVersions `
    -Text $popupHtml `
    -Pattern "<span\s+class=`"version-badge`">\s*v($VersionPattern)\s*</span>" `
    -Label "popup version badge"
  Assert-AllVersionsMatch -Label "Popup badge" -Versions $popupVersions -ExpectedVersion $manifestVersion

  $readme = Get-Content -LiteralPath $readmePath -Raw
  $readmeChecks = @(
    @{ Label = "README version badge"; Pattern = "version-($VersionPattern)-" },
    @{ Label = "README Chrome Web Store badge"; Pattern = "Chrome%20Web%20Store-available%20v($VersionPattern)-" },
    @{ Label = "README Edge Add-ons badge"; Pattern = "Edge%20Add--ons-available%20v($VersionPattern)-" },
    @{ Label = "README Store Availability version"; Pattern = "ClassGrab v($VersionPattern) is available for:" }
  )

  foreach ($check in $readmeChecks) {
    $versions = Get-RequiredRegexVersions -Text $readme -Pattern $check.Pattern -Label $check.Label
    Assert-AllVersionsMatch -Label $check.Label -Versions $versions -ExpectedVersion $manifestVersion
  }

  $currentChangelogHeading = "^###\s+v$([regex]::Escape($manifestVersion))\s*$"
  if (-not [regex]::IsMatch($readme, $currentChangelogHeading, [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
    throw "README changelog is missing a '### v$manifestVersion' heading."
  }

  Write-Host "Version sync OK: $manifestVersion"
  return $manifestVersion
}

function Get-ExpectedPackageEntries {
  $trackedArgs = @("-C", $RepoRoot, "ls-files", "--") + $PackageRoots
  $trackedFiles = @(& git @trackedArgs)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed while collecting package entries."
  }

  $expected = @($trackedFiles | Where-Object { $_ } | ForEach-Object { Normalize-ZipPath $_ } | Sort-Object)
  if ($expected.Count -eq 0) {
    throw "No tracked package entries were found."
  }

  $untrackedArgs = @("-C", $RepoRoot, "ls-files", "--others", "--exclude-standard", "--") + $PackageRoots
  $untrackedFiles = @(& git @untrackedArgs)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files --others failed while checking package roots."
  }

  if ($untrackedFiles.Count -gt 0) {
    $formatted = ($untrackedFiles | Sort-Object | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
    throw "Untracked files exist inside packaged roots. Track or move them before release:$([Environment]::NewLine)$formatted"
  }

  $missingFiles = @(
    $expected | Where-Object {
      $localPath = Join-Path $RepoRoot ($_ -replace "/", [IO.Path]::DirectorySeparatorChar)
      -not (Test-Path -LiteralPath $localPath -PathType Leaf)
    }
  )
  if ($missingFiles.Count -gt 0) {
    $formatted = ($missingFiles | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
    throw "Tracked package files are missing from disk:$([Environment]::NewLine)$formatted"
  }

  if (-not ($expected -contains "manifest.json")) {
    throw "manifest.json must be packaged at the ZIP root."
  }

  return $expected
}

function New-ReleaseZip {
  param(
    [Parameter(Mandatory = $true)][string[]]$Entries,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  Add-Type -AssemblyName System.IO.Compression

  $destinationParent = Split-Path -Parent $DestinationPath
  if ($destinationParent -and -not (Test-Path -LiteralPath $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent | Out-Null
  }

  if (Test-Path -LiteralPath $DestinationPath) {
    Remove-Item -LiteralPath $DestinationPath -Force
  }

  $fixedTimestamp = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  $zipStream = [IO.File]::Open($DestinationPath, [IO.FileMode]::CreateNew)
  $zip = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

  try {
    foreach ($entryName in $Entries) {
      $sourcePath = Join-Path $RepoRoot ($entryName -replace "/", [IO.Path]::DirectorySeparatorChar)
      $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $fixedTimestamp

      $entryStream = $entry.Open()
      $sourceStream = [IO.File]::OpenRead($sourcePath)
      try {
        $sourceStream.CopyTo($entryStream)
      } finally {
        $sourceStream.Dispose()
        $entryStream.Dispose()
      }
    }
  } finally {
    $zip.Dispose()
    $zipStream.Dispose()
  }
}

function Get-ZipEntries {
  param([Parameter(Mandatory = $true)][string]$ZipPath)

  Add-Type -AssemblyName System.IO.Compression

  $stream = [IO.File]::OpenRead($ZipPath)
  $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read)

  try {
    return @($zip.Entries | Where-Object { $_.Name } | ForEach-Object { Normalize-ZipPath $_.FullName } | Sort-Object)
  } finally {
    $zip.Dispose()
    $stream.Dispose()
  }
}

function Assert-ZipEntriesMatch {
  param(
    [Parameter(Mandatory = $true)][string[]]$Expected,
    [Parameter(Mandatory = $true)][string[]]$Actual
  )

  $expectedSet = @{}
  foreach ($entry in $Expected) {
    $expectedSet[$entry] = $true
  }

  $actualSet = @{}
  foreach ($entry in $Actual) {
    $actualSet[$entry] = $true
  }

  $missing = @($Expected | Where-Object { -not $actualSet.ContainsKey($_) })
  $extra = @($Actual | Where-Object { -not $expectedSet.ContainsKey($_) })

  if ($missing.Count -gt 0 -or $extra.Count -gt 0) {
    $message = "Packaged contents drift from the tracked store upload set."
    if ($missing.Count -gt 0) {
      $message += "$([Environment]::NewLine)Missing from ZIP:$([Environment]::NewLine)"
      $message += (($missing | ForEach-Object { "  - $_" }) -join [Environment]::NewLine)
    }
    if ($extra.Count -gt 0) {
      $message += "$([Environment]::NewLine)Unexpected in ZIP:$([Environment]::NewLine)"
      $message += (($extra | ForEach-Object { "  - $_" }) -join [Environment]::NewLine)
    }

    throw $message
  }

  if (-not ($Actual -contains "manifest.json")) {
    throw "manifest.json is not at the ZIP root."
  }
}

Push-Location $RepoRoot
try {
  $version = Assert-VersionSync

  Invoke-CheckedCommand -Command "node" -Arguments @("--check", "scripts/content.js")
  Invoke-CheckedCommand -Command "node" -Arguments @("--check", "scripts/popup.js")
  Invoke-CheckedCommand -Command "node" -Arguments @("--check", "scripts/background.js")
  Invoke-CheckedCommand -Command "node" -Arguments @("tools/download-batch.test.js")
  Invoke-CheckedCommand -Command "node" -Arguments @("tools/background-storage.test.js")
  Write-Host "==> tools/security-check.test.ps1"
  & (Join-Path $PSScriptRoot "security-check.test.ps1")
  Invoke-CheckedCommand -Command "git" -Arguments @("diff", "--check", "HEAD", "--")

  if ($ValidateOnly) {
    & (Join-Path $PSScriptRoot "security-check.ps1") -PackagePath $null
    if ($LASTEXITCODE -ne 0) {
      throw "Security/privacy check failed."
    }
    Write-Host "Validation OK."
    return
  }

  $expectedEntries = Get-ExpectedPackageEntries
  $resolvedOutputPath = if ([IO.Path]::IsPathRooted($OutputPath)) {
    [IO.Path]::GetFullPath($OutputPath)
  } else {
    [IO.Path]::GetFullPath((Join-Path $RepoRoot $OutputPath))
  }

  New-ReleaseZip -Entries $expectedEntries -DestinationPath $resolvedOutputPath
  $actualEntries = Get-ZipEntries -ZipPath $resolvedOutputPath
  Assert-ZipEntriesMatch -Expected $expectedEntries -Actual $actualEntries
  & (Join-Path $PSScriptRoot "security-check.ps1") -PackagePath $resolvedOutputPath
  if ($LASTEXITCODE -ne 0) {
    throw "Security/privacy check failed."
  }

  Write-Host "Package OK: $resolvedOutputPath"
  Write-Host "Packaged $($actualEntries.Count) files for ClassGrab v$version."
} finally {
  Pop-Location
}
