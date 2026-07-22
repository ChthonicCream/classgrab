#Requires -Version 5.1

[CmdletBinding()]
param(
  [string]$PackagePath = "ClassGrab.zip",
  [string]$RepositoryRoot = "",
  [switch]$GitPrivacyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
} else {
  [IO.Path]::GetFullPath($RepositoryRoot)
}
$AllowedPermissions = @("activeTab", "downloads", "storage")
$AllowedHostPermissions = @("https://drive.google.com/*", "https://drive.usercontent.google.com/*")
$AllowedContentScriptMatches = @("https://classroom.google.com/*")
$ExpectedLocales = @("en", "es", "fr", "zh_CN", "vi")
$PackageRoots = @("icons", "scripts", "styles", "views", "_locales", "manifest.json")
$PrivateGitEmailPattern = "^(?:[^@\s]+@users\.noreply\.github\.com|noreply@github\.com)$"
$RequiredLocaleMessages = @(
  "extensionName",
  "extensionDescription",
  "availableFiles",
  "selectAll",
  "downloadSelected",
  "downloadAll",
  "toggleTheme",
  "viewSource",
  "fileListLabel",
  "switchToLightMode",
  "switchToDarkMode",
  "requestFailed",
  "precheckFallbackNote",
  "driveConfirmationResolvedNote",
  "driveConfirmationManualNote",
  "downloadTrackingSaveWarning",
  "manualConfirmationOpenError",
  "selectAtLeastOneFile",
  "preparingFiles",
  "summaryStarted",
  "summaryManual",
  "summaryFailed",
  "summaryDriveHandling",
  "noDownloadsStarted",
  "notGoogleClassroom",
  "classroomOnly",
  "openClassroom",
  "activeTabReadError",
  "classroomConnectError",
  "unexpectedClassroomResponse",
  "refreshClassroomRetry",
  "noSupportedFiles",
  "openClassPost",
  "fileFailed",
  "downloadVerificationWarning",
  "htmlDownloadWarning",
  "statusReady",
  "statusPreparing",
  "statusStarted",
  "statusComplete",
  "statusFailed",
  "statusManual",
  "statusTrackingWarning",
  "statusUnknown",
  "statusHtmlWarning"
)
$TextExtensions = @(".css", ".html", ".js", ".json", ".md", ".ps1", ".svg", ".yml", ".yaml")

function Assert-EqualSet {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$Actual,
    [Parameter(Mandatory = $true)][string[]]$Expected
  )

  $actualSorted = @($Actual | Sort-Object)
  $expectedSorted = @($Expected | Sort-Object)
  $missing = @($expectedSorted | Where-Object { $_ -notin $actualSorted })
  $extra = @($actualSorted | Where-Object { $_ -notin $expectedSorted })

  if ($missing.Count -gt 0 -or $extra.Count -gt 0) {
    $message = "$Label drifted from the reviewed allowlist."
    if ($missing.Count -gt 0) {
      $message += "$([Environment]::NewLine)Missing expected entries:$([Environment]::NewLine)"
      $message += (($missing | ForEach-Object { "  - $_" }) -join [Environment]::NewLine)
    }
    if ($extra.Count -gt 0) {
      $message += "$([Environment]::NewLine)Unexpected entries:$([Environment]::NewLine)"
      $message += (($extra | ForEach-Object { "  - $_" }) -join [Environment]::NewLine)
    }

    throw $message
  }
}

function Get-AuditedFiles {
  $files = @(& git -C $RepoRoot ls-files --cached --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed while collecting files for security check."
  }

  return @($files | Where-Object { $_ })
}

function Get-TextAuditedFiles {
  return @(
    Get-AuditedFiles | Where-Object {
      $extension = [IO.Path]::GetExtension($_).ToLowerInvariant()
      $TextExtensions -contains $extension
    }
  )
}

function Get-PackagedTextFiles {
  $trackedArgs = @("-C", $RepoRoot, "ls-files", "--") + $PackageRoots
  $files = @(& git @trackedArgs)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed while collecting packaged text files for security check."
  }

  return @(
    $files | Where-Object {
      $extension = [IO.Path]::GetExtension($_).ToLowerInvariant()
      $TextExtensions -contains $extension
    }
  )
}

function Assert-GitRepositoryPrivacy {
  $logLines = @(& git -C $RepoRoot log "--format=%H`t%ae`t%ce" HEAD --branches --tags)
  if ($LASTEXITCODE -ne 0) {
    throw "git log failed while checking commit identity privacy."
  }
  if ($logLines.Count -eq 0) {
    throw "No reachable commits were found for the Git identity privacy check."
  }

  $findings = New-Object System.Collections.Generic.List[string]
  foreach ($line in $logLines) {
    $parts = @($line -split "`t", 3)
    if ($parts.Count -ne 3) {
      throw "Unexpected git log output while checking commit identity privacy."
    }

    $commit = $parts[0].Substring(0, [Math]::Min(12, $parts[0].Length))
    if ($parts[1] -notmatch $PrivateGitEmailPattern) {
      $findings.Add("commit $commit has a non-noreply author identity")
    }
    if ($parts[2] -notmatch $PrivateGitEmailPattern) {
      $findings.Add("commit $commit has a non-noreply committer identity")
    }
  }

  $remoteNames = @(& git -C $RepoRoot remote)
  if ($LASTEXITCODE -ne 0) {
    throw "git remote failed while checking remote URL privacy."
  }

  foreach ($remoteName in $remoteNames) {
    $fetchUrls = @(& git -C $RepoRoot remote get-url --all $remoteName)
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect fetch URLs for Git remote '$remoteName'."
    }
    $pushUrls = @(& git -C $RepoRoot remote get-url --push --all $remoteName)
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect push URLs for Git remote '$remoteName'."
    }
    $remoteUrls = @($fetchUrls + $pushUrls | Sort-Object -Unique)

    foreach ($remoteUrl in $remoteUrls) {
      $hasHttpCredentials = $remoteUrl -match "(?i)^https?://[^/@\s]+@"
      $hasKnownToken = $remoteUrl -match "(?i)(?:ghp_|github_pat_|[?&](?:access_token|token)=)"
      if ($hasHttpCredentials -or $hasKnownToken) {
        $findings.Add("remote '$remoteName' contains credentials in its URL")
      }
    }
  }

  if ($findings.Count -gt 0) {
    throw "Git repository privacy check failed:$([Environment]::NewLine)$(($findings | Sort-Object -Unique) -join [Environment]::NewLine)"
  }
}

function Assert-ManifestSecurity {
  $manifestPath = Join-Path $RepoRoot "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

  if ($manifest.manifest_version -ne 3) {
    throw "manifest.json must remain Manifest V3."
  }

  if ([string]$manifest.name -ne "__MSG_extensionName__") {
    throw "manifest.json name must use the reviewed i18n message reference."
  }

  if ([string]$manifest.description -ne "__MSG_extensionDescription__") {
    throw "manifest.json description must use the reviewed i18n message reference."
  }

  if ([string]$manifest.default_locale -ne "en") {
    throw "manifest.json default_locale must remain 'en'."
  }

  Assert-EqualSet -Label "Extension permissions" -Actual @($manifest.permissions) -Expected $AllowedPermissions
  Assert-EqualSet -Label "Host permissions" -Actual @($manifest.host_permissions) -Expected $AllowedHostPermissions

  $matches = @()
  foreach ($script in @($manifest.content_scripts)) {
    $matches += @($script.matches)
  }
  Assert-EqualSet -Label "Content script matches" -Actual $matches -Expected $AllowedContentScriptMatches

  $csp = [string]$manifest.content_security_policy.extension_pages
  if ($csp -match "unsafe-inline|unsafe-eval|https?://") {
    throw "Extension CSP must not allow inline code, eval, or remote script origins."
  }
}

function Assert-Locales {
  $localesRoot = Join-Path $RepoRoot "_locales"
  if (-not (Test-Path -LiteralPath $localesRoot -PathType Container)) {
    throw "_locales directory is missing."
  }

  $actualLocales = @(
    Get-ChildItem -LiteralPath $localesRoot -Directory |
      ForEach-Object { $_.Name }
  )
  Assert-EqualSet -Label "Extension locales" -Actual $actualLocales -Expected $ExpectedLocales

  foreach ($locale in $ExpectedLocales) {
    $messagesPath = Join-Path $localesRoot (Join-Path $locale "messages.json")
    if (-not (Test-Path -LiteralPath $messagesPath -PathType Leaf)) {
      throw "Missing locale message file: _locales/$locale/messages.json"
    }

    $messages = Get-Content -LiteralPath $messagesPath -Raw | ConvertFrom-Json
    $messageNames = @($messages.PSObject.Properties.Name)
    $missingMessages = @($RequiredLocaleMessages | Where-Object { $_ -notin $messageNames })
    if ($missingMessages.Count -gt 0) {
      throw "_locales/$locale/messages.json is missing required messages:$([Environment]::NewLine)$(($missingMessages | ForEach-Object { "  - $_" }) -join [Environment]::NewLine)"
    }

    foreach ($messageName in $RequiredLocaleMessages) {
      $messageProperty = $messages.PSObject.Properties[$messageName]
      $messageValue = [string]$messageProperty.Value.message
      if ([string]::IsNullOrWhiteSpace($messageValue)) {
        throw "_locales/$locale/messages.json has an empty message for '$messageName'."
      }
    }
  }
}

function Assert-NoTextLeaks {
  $patterns = @(
    @{ Name = "private key"; Regex = "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
    @{ Name = "GitHub token"; Regex = "ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}" },
    @{ Name = "OpenAI-style API key"; Regex = "sk-[A-Za-z0-9_-]{20,}" },
    @{ Name = "Google API key"; Regex = "AIza[0-9A-Za-z_-]{20,}" },
    @{ Name = "AWS access key"; Regex = "AKIA[0-9A-Z]{16}" },
    @{ Name = "Slack token"; Regex = "xox[baprs]-[A-Za-z0-9-]{20,}" },
    @{ Name = "email address"; Regex = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" },
    @{ Name = "real Classroom class URL"; Regex = "classroom\.google\.com/(?:u/\d+/)?c/[A-Za-z0-9_-]{8,}" },
    @{ Name = "real Drive file URL"; Regex = "drive\.google\.com/file/d/[A-Za-z0-9_-]{8,}" },
    @{ Name = "real Docs editor URL"; Regex = "docs\.google\.com/(?:document|spreadsheets|presentation)/d/[A-Za-z0-9_-]{8,}" },
    @{ Name = "hardcoded secret assignment"; Regex = "(?i)(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['""][^'""]{8,}['""]" }
  )

  $findings = New-Object System.Collections.Generic.List[string]

  foreach ($relativePath in Get-TextAuditedFiles) {
    $path = Join-Path $RepoRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      continue
    }

    $text = Get-Content -LiteralPath $path -Raw

    foreach ($pattern in $patterns) {
      if ([regex]::IsMatch($text, $pattern.Regex)) {
        $findings.Add("$relativePath matched $($pattern.Name)")
      }
    }
  }

  if ($findings.Count -gt 0) {
    throw "Potential secret or personal-data leak found:$([Environment]::NewLine)$(($findings | Sort-Object) -join [Environment]::NewLine)"
  }
}

function Assert-NoPngTextMetadata {
  $findings = New-Object System.Collections.Generic.List[string]

  foreach ($relativePath in Get-AuditedFiles) {
    if ([IO.Path]::GetExtension($relativePath).ToLowerInvariant() -ne ".png") {
      continue
    }

    $path = Join-Path $RepoRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($path)
    if ($bytes.Length -lt 8) {
      $findings.Add("$relativePath is too small to be a valid PNG")
      continue
    }

    $signature = @(137, 80, 78, 71, 13, 10, 26, 10)
    for ($i = 0; $i -lt $signature.Count; $i += 1) {
      if ($bytes[$i] -ne $signature[$i]) {
        $findings.Add("$relativePath has an invalid PNG signature")
        continue 2
      }
    }

    $offset = 8
    while ($offset + 12 -le $bytes.Length) {
      $lengthBytes = [byte[]]@($bytes[$offset + 3], $bytes[$offset + 2], $bytes[$offset + 1], $bytes[$offset])
      $length = [BitConverter]::ToUInt32($lengthBytes, 0)
      $type = [Text.Encoding]::ASCII.GetString($bytes, $offset + 4, 4)

      if ($type -in @("tEXt", "zTXt", "iTXt")) {
        $findings.Add("$relativePath contains PNG text metadata chunk $type")
      }

      $offset += 12 + [int64]$length
      if ($type -eq "IEND") {
        break
      }
    }
  }

  if ($findings.Count -gt 0) {
    throw "PNG metadata check failed:$([Environment]::NewLine)$(($findings | Sort-Object) -join [Environment]::NewLine)"
  }
}

function Assert-NoPackagedFootguns {
  $patterns = @(
    @{ Name = "eval"; Regex = "\beval\s*\(" },
    @{ Name = "Function constructor"; Regex = "\bnew\s+Function\s*\(" },
    @{ Name = "document.write"; Regex = "\bdocument\.write\s*\(" },
    @{ Name = "innerHTML"; Regex = "\.innerHTML\b" },
    @{ Name = "outerHTML"; Regex = "\.outerHTML\b" },
    @{ Name = "insertAdjacentHTML"; Regex = "\.insertAdjacentHTML\s*\(" },
    @{ Name = "string setTimeout"; Regex = "\bsetTimeout\s*\(\s*['""]" },
    @{ Name = "string setInterval"; Regex = "\bsetInterval\s*\(\s*['""]" },
    @{ Name = "insecure HTTP URL"; Regex = "http://" }
  )

  $packagedTextFiles = Get-PackagedTextFiles
  $findings = New-Object System.Collections.Generic.List[string]

  foreach ($relativePath in $packagedTextFiles) {
    $path = Join-Path $RepoRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    $text = (Get-Content -LiteralPath $path -Raw) -replace "http://www\.w3\.org/2000/svg", ""

    foreach ($pattern in $patterns) {
      if ([regex]::IsMatch($text, $pattern.Regex)) {
        $findings.Add("$relativePath uses $($pattern.Name)")
      }
    }
  }

  $popupHtml = Get-Content -LiteralPath (Join-Path $RepoRoot "views/popup.html") -Raw
  if ($popupHtml -match "<script[^>]+src=['""]https?://" -or $popupHtml -match "<link[^>]+href=['""]https?://") {
    $findings.Add("views/popup.html loads remote scripts or styles")
  }

  if ($findings.Count -gt 0) {
    throw "Packaged extension security check failed:$([Environment]::NewLine)$(($findings | Sort-Object) -join [Environment]::NewLine)"
  }
}

function Assert-PackageHasNoPrivateFiles {
  param([Parameter(Mandatory = $true)][string]$ZipPath)

  if ([string]::IsNullOrEmpty($ZipPath) -or -not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    return
  }

  Add-Type -AssemblyName System.IO.Compression
  $stream = [IO.File]::OpenRead($ZipPath)
  $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read)

  try {
    $forbidden = @(
      $zip.Entries |
        Where-Object {
          $_.FullName -match "(^|/)(assets|\.github|\.git|tools)/" -or
          $_.FullName -match "(publishing_guide|screenshot|classroom|README|\.env|secret|token)"
        } |
        ForEach-Object { $_.FullName }
    )
  } finally {
    $zip.Dispose()
    $stream.Dispose()
  }

  if ($forbidden.Count -gt 0) {
    throw "Private or non-store files were found in the package:$([Environment]::NewLine)$(($forbidden | Sort-Object) -join [Environment]::NewLine)"
  }
}

Push-Location $RepoRoot
try {
  Assert-GitRepositoryPrivacy
  if ($GitPrivacyOnly) {
    Write-Host "Git repository privacy check OK."
    return
  }
  Assert-ManifestSecurity
  Assert-Locales
  Assert-NoTextLeaks
  Assert-NoPngTextMetadata
  Assert-NoPackagedFootguns

  $resolvedPackagePath = if ([IO.Path]::IsPathRooted($PackagePath)) {
    [IO.Path]::GetFullPath($PackagePath)
  } else {
    [IO.Path]::GetFullPath((Join-Path $RepoRoot $PackagePath))
  }
  Assert-PackageHasNoPrivateFiles -ZipPath $resolvedPackagePath

  Write-Host "Security/privacy check OK."
} finally {
  Pop-Location
}
