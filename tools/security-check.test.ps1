#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SecurityCheck = Join-Path $PSScriptRoot "security-check.ps1"
$FixtureRoots = New-Object System.Collections.Generic.List[string]
$SafeEmail = "classgrab-test" + "@users.noreply.github.com"
$UnsafeEmail = "classgrab-test" + "@example.invalid"
$CredentialUrl = "https://credential" + "@example.invalid/classgrab.git"
$CleanUrl = "https://example.invalid/classgrab.git"

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & git -C $WorkingDirectory @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Fixture Git command failed: git $($Arguments -join ' ')"
  }
}

function New-PrivacyFixtureRepo {
  param([Parameter(Mandatory = $true)][string]$Email)

  $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("classgrab-security-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
  $FixtureRoots.Add($fixtureRoot)

  Invoke-Git -WorkingDirectory $fixtureRoot -Arguments @("init", "--quiet")
  Invoke-Git -WorkingDirectory $fixtureRoot -Arguments @("config", "user.name", "ClassGrab Privacy Fixture")
  Invoke-Git -WorkingDirectory $fixtureRoot -Arguments @("config", "user.email", $Email)
  Invoke-Git -WorkingDirectory $fixtureRoot -Arguments @("-c", "commit.gpgsign=false", "commit", "--allow-empty", "--quiet", "-m", "privacy fixture")

  return $fixtureRoot
}

function Invoke-PrivacyCheck {
  param([Parameter(Mandatory = $true)][string]$FixtureRoot)

  & $SecurityCheck -RepositoryRoot $FixtureRoot -PackagePath $null -GitPrivacyOnly | Out-Null
}

function Assert-PrivacyCheckFails {
  param(
    [Parameter(Mandatory = $true)][string]$FixtureRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedPattern
  )

  try {
    Invoke-PrivacyCheck -FixtureRoot $FixtureRoot
  } catch {
    if ($_.Exception.Message -notmatch $ExpectedPattern) {
      throw
    }
    return
  }

  throw "Git privacy fixture unexpectedly passed: $ExpectedPattern"
}

try {
  $safeRepo = New-PrivacyFixtureRepo -Email $SafeEmail
  Invoke-Git -WorkingDirectory $safeRepo -Arguments @("remote", "add", "origin", $CleanUrl)
  Invoke-PrivacyCheck -FixtureRoot $safeRepo

  $unsafeIdentityRepo = New-PrivacyFixtureRepo -Email $UnsafeEmail
  Assert-PrivacyCheckFails -FixtureRoot $unsafeIdentityRepo -ExpectedPattern "non-noreply"

  Invoke-Git -WorkingDirectory $safeRepo -Arguments @("remote", "set-url", "origin", $CredentialUrl)
  Assert-PrivacyCheckFails -FixtureRoot $safeRepo -ExpectedPattern "contains credentials"

  Invoke-Git -WorkingDirectory $safeRepo -Arguments @("remote", "set-url", "origin", $CleanUrl)
  Invoke-Git -WorkingDirectory $safeRepo -Arguments @("remote", "set-url", "--add", "--push", "origin", $CredentialUrl)
  Assert-PrivacyCheckFails -FixtureRoot $safeRepo -ExpectedPattern "contains credentials"

  Write-Host "Git privacy fixture tests passed."
} finally {
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  foreach ($fixtureRoot in $FixtureRoots) {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedFixture)).StartsWith("classgrab-security-")) {
      throw "Refusing to remove unexpected fixture path: $resolvedFixture"
    }
    if (Test-Path -LiteralPath $resolvedFixture) {
      Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
  }
}
