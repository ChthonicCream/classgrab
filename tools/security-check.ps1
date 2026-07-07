#Requires -Version 5.1

[CmdletBinding()]
param(
  [string]$PackagePath = "ClassGrab.zip"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AllowedPermissions = @("activeTab", "downloads", "storage")
$AllowedHostPermissions = @("https://drive.google.com/*", "https://drive.usercontent.google.com/*")
$AllowedContentScriptMatches = @("https://classroom.google.com/*")
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

function Assert-ManifestSecurity {
  $manifestPath = Join-Path $RepoRoot "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

  if ($manifest.manifest_version -ne 3) {
    throw "manifest.json must remain Manifest V3."
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

  $packagedTextFiles = @("scripts/background.js", "scripts/content.js", "scripts/popup.js", "styles/styles.css", "views/popup.html", "manifest.json")
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

  if (-not (Test-Path -LiteralPath $ZipPath)) {
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
  Assert-ManifestSecurity
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
