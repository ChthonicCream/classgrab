#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$HookPath = Join-Path $RepoRoot ".githooks\pre-push"

if (-not (Test-Path -LiteralPath $HookPath -PathType Leaf)) {
  throw "Missing tracked pre-push hook: .githooks/pre-push"
}

if ($env:OS -ne "Windows_NT") {
  & chmod u+x -- $HookPath
  if ($LASTEXITCODE -ne 0) {
    throw "Could not make the ClassGrab pre-push hook executable."
  }
}

$configuredPath = & git -C $RepoRoot config --local --get core.hooksPath
if ($LASTEXITCODE -notin @(0, 1)) {
  throw "Could not inspect the existing Git hooks path."
}
if ($configuredPath -and $configuredPath -ne ".githooks") {
  throw "Refusing to replace existing core.hooksPath '$configuredPath'. Chain the ClassGrab validation from the existing hooks instead."
}

if (-not $configuredPath) {
  $defaultHooksPath = & git -C $RepoRoot rev-parse --git-path hooks
  if ($LASTEXITCODE -ne 0) {
    throw "Could not locate the repository's default hooks directory."
  }
  if (-not [IO.Path]::IsPathRooted($defaultHooksPath)) {
    $defaultHooksPath = Join-Path $RepoRoot $defaultHooksPath
  }
  $existingHooks = @(
    Get-ChildItem -LiteralPath $defaultHooksPath -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch "\.sample$" }
  )
  if ($existingHooks.Count -gt 0) {
    throw "Refusing to bypass existing hooks in the default Git hooks directory. Chain the ClassGrab validation from those hooks instead."
  }
}

& git -C $RepoRoot config --local core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
  throw "Could not configure the ClassGrab Git hooks path."
}

$verifiedPath = & git -C $RepoRoot config --local --get core.hooksPath
if ($LASTEXITCODE -ne 0 -or $verifiedPath -ne ".githooks") {
  throw "ClassGrab Git hooks path verification failed."
}

Write-Host "ClassGrab pre-push security validation installed."
