#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent $PSScriptRoot
$VersionPattern = "\d+(?:\.\d+){1,3}"
$parseTokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot "release.ps1"), [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "release.ps1 could not be parsed." }
# Load the real validation functions without running the release entry point.
foreach ($statement in $ast.EndBlock.Statements) {
  if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) {
    Invoke-Expression $statement.Extent.Text
  }
}

function Assert-Rejected {
  param([scriptblock]$Operation, [string]$Pattern)
  try { & $Operation | Out-Null } catch {
    if ($_.Exception.Message -notmatch $Pattern) { throw }
    return
  }
  throw "Invalid release fixture unexpectedly passed: $Pattern"
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$RepoRoot = Join-Path $tempRoot ("classgrab-release-check-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path (Join-Path $RepoRoot "docs"),(Join-Path $RepoRoot "views"),(Join-Path $RepoRoot "scripts") | Out-Null
try {
  foreach ($path in @("manifest.json", "README.md", "views/popup.html", "docs/store-submission.md", "scripts/content.js")) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $path) -Destination (Join-Path $RepoRoot $path)
  }
  $version = Assert-VersionSync
  $guidePath = Join-Path $RepoRoot "docs/store-submission.md"
  $guide = Get-Content -LiteralPath $guidePath -Raw
  $wrongVersion = if ($version -eq "9.9.9") { "9.9.8" } else { "9.9.9" }
  ($guide -replace '(?m)^# Submit the ClassGrab [0-9.]+ update', "# Submit the ClassGrab $wrongVersion update") |
    Set-Content -LiteralPath $guidePath -Encoding UTF8
  Assert-Rejected { Assert-VersionSync } "Store guide heading version mismatch"
  ($guide -replace '(?m)^Upload version: `[0-9.]+`\.', ('Upload version: `' + $wrongVersion + '`.')) |
    Set-Content -LiteralPath $guidePath -Encoding UTF8
  Assert-Rejected { Assert-VersionSync } "Store guide upload version version mismatch"

  $entries = @("manifest.json", "scripts/content.js")
  $zipPath = Join-Path $RepoRoot "fixture.zip"
  New-ReleaseZip -Entries $entries -DestinationPath $zipPath
  Assert-ZipEntriesMatch -Expected $entries -Actual (Get-ZipEntries $zipPath)
  Assert-ZipPayloadMatches -ZipPath $zipPath -ExpectedVersion $version
  Assert-Rejected { Assert-ZipEntriesMatch -Expected $entries -Actual ($entries + "manifest.json") } "Duplicate file entries"

  Add-Content -LiteralPath (Join-Path $RepoRoot "scripts/content.js") -Value "// Synthetic checkout change"
  Assert-Rejected { Assert-ZipPayloadMatches -ZipPath $zipPath -ExpectedVersion $version } "ZIP payload differs"
  $manifestPath = Join-Path $RepoRoot "manifest.json"
  ((Get-Content -LiteralPath $manifestPath -Raw) -replace ('"version": "' + [regex]::Escape($version) + '"'), ('"version": "' + $wrongVersion + '"')) |
    Set-Content -LiteralPath $manifestPath -Encoding UTF8
  New-ReleaseZip -Entries $entries -DestinationPath $zipPath
  Assert-Rejected { Assert-ZipPayloadMatches -ZipPath $zipPath -ExpectedVersion $version } "ZIP manifest version mismatch"
  Write-Host "Release guide/version, duplicate-entry, and ZIP payload fixture tests passed."
} finally {
  $resolvedFixture = [IO.Path]::GetFullPath($RepoRoot)
  if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      -not ([IO.Path]::GetFileName($resolvedFixture)).StartsWith("classgrab-release-check-")) {
    throw "Refusing to remove unexpected release fixture path."
  }
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
